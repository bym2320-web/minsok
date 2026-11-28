(function () {
  'use strict';

  const COLLECTION = 'ribsDelivery';

  // 기본 업체-지역 매핑 목록
  const DEFAULT_VENDORS = [
    { id: 'v_1', name: '초우', region: '서울' },
    { id: 'v_2', name: '민축산', region: '대구' },
    { id: 'v_3', name: '동선', region: '해운대' },
    { id: 'v_4', name: '동우', region: '대구' },
    { id: 'v_5', name: '한우리', region: '울산' },
    { id: 'v_6', name: '토함', region: '울산' },
    { id: 'v_7', name: '뉴서울', region: '안동' },
    { id: 'v_8', name: '삼남매', region: '안동' }
  ];

  const RIB_GRADES = ['1++9', '1++8', '1++7', '1+', '1등급', '2등급', '기타'];
  const WEEKDAYS = ['월', '화', '수', '목', '금', '토'];

  const ribsState = {
    subTab: 'notice', // 'notice' | 'order'
    vendors: DEFAULT_VENDORS.slice(),
    notices: [], // 최신순 짝갈비 배송 공지 목록
    orders: [],  // 짝갈비 발주 목록

    // 배송 공지 작성 상태
    draftText: '',
    editingNoticeId: null,
    showVendorManager: false,

    // 짝갈비 발주 입력 폼 상태
    editingOrderId: null,
    orderVendor: '',
    orderDays: '',
    orderGrade: '1++9',
    orderQty: '1',
    orderNote: '',

    initialized: false,
    listenersBound: false
  };

  function getBridge() {
    return window.MinsokBridge || null;
  }

  function esc(val) {
    const b = getBridge();
    if (b && typeof b.escapeHtml === 'function') return b.escapeHtml(val);
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  }

  function formatQtyText(qty) {
    const raw = String(qty == null ? '' : qty).trim();
    if (!raw) return '1짝';
    return raw.endsWith('짝') ? raw : `${raw}짝`;
  }

  // 업체명에 등록된 지역 자동 부착 (이미 괄호 지역이 있으면 유지)
  function attachVendorRegion(vendorInput) {
    const raw = String(vendorInput || '').trim();
    if (!raw) return '';
    if (/\([^)]+\)/.test(raw)) return raw;

    const vendors = (ribsState.vendors || []).filter(function (v) { return v && v.name && v.region; });
    const found = vendors.find(function (v) { return v.name === raw; });
    return found ? `${found.name}(${found.region})` : raw;
  }

  /**
   * 짝갈비 텍스트 자동 업체-지역 매칭 변환
   * 예: "- 초우: 33,35,36,39" -> "- 초우(서울): 33,35,36,39"
   * 예: "- 동선(토): 26,30" -> "- 동선(토)(해운대): 26,30"
   * 도체번호 및 아래 줄 메모("38번 안창제거 18700" 등)는 그대로 유지
   */
  function applyVendorRegions(rawText) {
    if (!rawText) return '';
    const vendors = (ribsState.vendors || [])
      .filter(function (v) { return v && v.name && v.region; })
      .slice()
      .sort(function (a, b) { return b.name.length - a.name.length; });

    const lines = String(rawText).split('\n');
    const converted = lines.map(function (line) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return line;

      const leftPart = line.slice(0, colonIdx);
      const rightPart = line.slice(colonIdx);

      const match = leftPart.match(/^([\s\u200B-\u200D\uFEFF\-•*]*)(.+?)(\s*)$/);
      if (!match) return line;

      const prefix = match[1];
      const rawVendorLabel = match[2].trim();
      const suffixSpace = match[3];
      const baseName = rawVendorLabel.replace(/\(.*$/, '').trim();

      let matchedVendor = null;
      for (let i = 0; i < vendors.length; i++) {
        if (vendors[i].name === baseName || vendors[i].name === rawVendorLabel) {
          matchedVendor = vendors[i];
          break;
        }
      }

      if (!matchedVendor) return line;

      const regionTag = `(${matchedVendor.region})`;
      if (rawVendorLabel.includes(regionTag)) return line;

      return `${prefix}${rawVendorLabel}${regionTag}${suffixSpace}${rightPart}`;
    });

    return converted.join('\n');
  }

  function copyToClipboard(text, msg) {
    const b = getBridge();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (b) b.showToast(msg || '복사되었습니다.');
      }).catch(function () {
        if (b) b.showToast('복사에 실패했습니다.');
      });
    } else if (b) {
      b.showToast('이 브라우저에서는 자동 복사를 지원하지 않습니다.');
    }
  }

  function formatSingleOrderCopy(ord) {
    const daysPart = ord.days ? ` [${ord.days}]` : '';
    const donePart = ord.done ? ' (배정완료)' : '';
    const lines = [
      `■ ${ord.vendor}${daysPart}${donePart}`,
      `  - ${ord.grade} / ${formatQtyText(ord.qty)}`
    ];
    if (ord.note && ord.note.trim()) {
      lines.push(`  ※ ${ord.note.trim()}`);
    }
    return lines.join('\n');
  }

  function buildAllOrdersCopyText() {
    const sorted = getSortedOrders();
    if (sorted.length === 0) return '[짝갈비 발주 현황]\n등록된 발주 내역이 없습니다.';
    const lines = ['[짝갈비 발주 현황]', ''];
    sorted.forEach(function (ord) {
      lines.push(formatSingleOrderCopy(ord));
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function getSortedOrders() {
    return (ribsState.orders || []).slice().sort(function (a, b) {
      const aDone = a.done ? 1 : 0;
      const bDone = b.done ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function initFirestoreSync() {
    const b = getBridge();
    if (!b) return;
    const db = b.getDb();
    if (!db) return;

    // 1. 업체-지역 매핑 실시간 동기화
    db.collection(COLLECTION).doc('vendors').onSnapshot(function (doc) {
      if (doc.exists && Array.isArray(doc.data().list)) {
        ribsState.vendors = doc.data().list;
      } else {
        ribsState.vendors = DEFAULT_VENDORS.slice();
      }
      render();
    }, function (err) {
      console.error('ribsDelivery/vendors onSnapshot 오류:', err);
    });

    // 2. 짝갈비 배송 공지 목록 실시간 동기화
    db.collection(COLLECTION).doc('notices').onSnapshot(function (doc) {
      if (doc.exists && Array.isArray(doc.data().list)) {
        ribsState.notices = doc.data().list.slice().sort(function (a, b) {
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
      } else {
        ribsState.notices = [];
      }
      render();
    }, function (err) {
      console.error('ribsDelivery/notices onSnapshot 오류:', err);
    });

    // 3. 짝갈비 발주 목록 실시간 동기화
    db.collection(COLLECTION).doc('orders').onSnapshot(function (doc) {
      if (doc.exists && Array.isArray(doc.data().list)) {
        ribsState.orders = doc.data().list;
      } else {
        ribsState.orders = [];
      }
      render();
    }, function (err) {
      console.error('ribsDelivery/orders onSnapshot 오류:', err);
    });
  }

  function saveVendorsToDb(nextList, successMsg) {
    const b = getBridge();
    if (!b) return;
    const db = b.getDb();
    if (!db) return;

    db.collection(COLLECTION).doc('vendors').set({
      list: nextList,
      updatedAt: Date.now()
    }).then(function () {
      if (successMsg) b.showToast(successMsg);
    }).catch(function (err) {
      console.error('업체-지역 저장 오류:', err);
      b.showToast('업체-지역 저장 중 오류가 발생했습니다.');
    });
  }

  function saveOrdersToDb(nextList, toastMsg, pushBody) {
    const b = getBridge();
    if (!b) return;
    const db = b.getDb();
    const user = b.getCurrentUser();
    if (!db) return;

    // 최근 60건 유지
    const trimmed = nextList.length > 60 ? nextList.slice(0, 60) : nextList;

    db.collection(COLLECTION).doc('orders').set({
      list: trimmed,
      updatedAt: Date.now()
    }).then(function () {
      if (toastMsg) b.showToast(toastMsg);
      if (pushBody && user && typeof b.sendFcmPushForRibs === 'function') {
        b.sendFcmPushForRibs(pushBody, user.name);
      }
    }).catch(function (err) {
      console.error('짝갈비 발주 저장 오류:', err);
      b.showToast('발주 저장 중 오류가 발생했습니다.');
    });
  }

  function submitRibsNotice() {
    const b = getBridge();
    if (!b) return;
    const db = b.getDb();
    const user = b.getCurrentUser();
    if (!db || !user) return;

    const raw = (ribsState.draftText || '').trim();
    if (!raw) {
      b.showToast('짝갈비 배송 내용을 입력해 주세요.');
      return;
    }

    const formatted = applyVendorRegions(raw);
    const now = Date.now();
    let nextNotices = ribsState.notices.slice();

    if (ribsState.editingNoticeId) {
      nextNotices = nextNotices.map(function (item) {
        if (item.id === ribsState.editingNoticeId) {
          return Object.assign({}, item, {
            content: formatted,
            updatedAt: now,
            updatedBy: user.name
          });
        }
        return item;
      });
    } else {
      nextNotices.unshift({
        id: 'rib_' + now + '_' + Math.random().toString(36).slice(2, 6),
        content: formatted,
        authorName: user.name,
        createdAt: now,
        updatedAt: null,
        updatedBy: null
      });
    }

    if (nextNotices.length > 30) {
      nextNotices = nextNotices.slice(0, 30);
    }

    const isEdit = !!ribsState.editingNoticeId;
    ribsState.draftText = '';
    ribsState.editingNoticeId = null;

    db.collection(COLLECTION).doc('notices').set({
      list: nextNotices,
      updatedAt: now
    }).then(function () {
      b.showToast(isEdit ? '짝갈비 배송 공지가 수정되었습니다.' : '짝갈비 배송 공지가 등록되었습니다.');
      if (typeof b.sendFcmPushForRibs === 'function') {
        const previewLine = formatted.split('\n').filter(Boolean).slice(0, 2).join(' / ');
        b.sendFcmPushForRibs(previewLine, user.name);
      }
      render();
    }).catch(function (err) {
      console.error('짝갈비 공지 저장 오류:', err);
      b.showToast('공지 저장 중 오류가 발생했습니다.');
    });
  }

  function resetOrderForm() {
    ribsState.editingOrderId = null;
    ribsState.orderVendor = '';
    ribsState.orderDays = '';
    ribsState.orderGrade = '1++9';
    ribsState.orderQty = '1';
    ribsState.orderNote = '';
  }

  function submitRibsOrder() {
    const b = getBridge();
    if (!b) return;
    const user = b.getCurrentUser();
    if (!user) return;

    const vendor = attachVendorRegion(ribsState.orderVendor);
    if (!vendor) {
      b.showToast('업체명을 입력하거나 선택해 주세요.');
      return;
    }

    const days = String(ribsState.orderDays || '').trim();
    const grade = ribsState.orderGrade || '1++9';
    const qtyRaw = String(ribsState.orderQty || '').replace(/짝$/g, '').trim() || '1';
    const note = String(ribsState.orderNote || '').trim();
    const now = Date.now();

    let nextOrders = ribsState.orders.slice();
    const isEdit = !!ribsState.editingOrderId;

    if (isEdit) {
      nextOrders = nextOrders.map(function (ord) {
        if (ord.id === ribsState.editingOrderId) {
          return Object.assign({}, ord, {
            vendor: vendor,
            days: days,
            grade: grade,
            qty: qtyRaw,
            note: note,
            updatedAt: now,
            updatedBy: user.name
          });
        }
        return ord;
      });
    } else {
      nextOrders.unshift({
        id: 'rord_' + now + '_' + Math.random().toString(36).slice(2, 6),
        vendor: vendor,
        days: days,
        grade: grade,
        qty: qtyRaw,
        note: note,
        done: false,
        authorName: user.name,
        createdAt: now,
        updatedAt: null,
        updatedBy: null
      });
    }

    resetOrderForm();
    render();

    const daysBadge = days ? ` (${days})` : '';
    const pushBody = `[짝갈비 발주] ${vendor} · ${grade} ${formatQtyText(qtyRaw)}${daysBadge}${note ? ' · ' + note : ''}`;
    saveOrdersToDb(
      nextOrders,
      isEdit ? `'${vendor}' 발주가 수정되었습니다.` : `'${vendor}' 짝갈비 발주가 등록되었습니다.`,
      pushBody
    );
  }

  // =========================================================
  // 렌더링: 상단 통합 바 (2개 서브 탭 + 업체·지역 설정 토글)
  // =========================================================
  function renderTopHeaderHtml() {
    const isNotice = ribsState.subTab === 'notice';
    const pendingOrderCount = (ribsState.orders || []).filter(function (o) { return !o.done; }).length;

    const vendorRowsHtml = (ribsState.vendors || []).map(function (v) {
      return `
        <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-xs font-extrabold text-slate-900 truncate">${esc(v.name)}</span>
            <span class="px-1.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-extrabold shrink-0">${esc(v.region)}</span>
          </div>
          <button
            type="button"
            data-rib-del-vendor="${esc(v.id)}"
            class="w-5 h-5 rounded-md bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-400 hover:text-red-600 text-[10px] font-bold cursor-pointer transition shrink-0"
            title="삭제"
          >✕</button>
        </div>
      `;
    }).join('');

    return `
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div class="p-3 flex items-center justify-between gap-2 flex-wrap">
          <!-- 2개 서브 탭: [배송 공지] / [짝갈비 발주] -->
          <div class="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
            <button
              type="button"
              data-rib-subtab="notice"
              class="px-3.5 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${isNotice ? 'bg-[#B30E2A] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
            >
              📦 배송 공지
            </button>
            <button
              type="button"
              data-rib-subtab="order"
              class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${!isNotice ? 'bg-[#B30E2A] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
            >
              <span>📝 짝갈비 발주</span>
              ${pendingOrderCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold leading-none ${!isNotice ? 'bg-white text-[#B30E2A]' : 'bg-[#B30E2A] text-white'}">${pendingOrderCount}</span>` : ''}
            </button>
          </div>

          <!-- 우측 컴팩트 업체·지역 설정 버튼 -->
          <button
            type="button"
            data-rib-toggle-vendors="1"
            class="px-3 py-2 rounded-xl border text-xs font-extrabold cursor-pointer transition whitespace-nowrap ${ribsState.showVendorManager ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'}"
          >
            🏢 업체·지역 (${ribsState.vendors.length}) ${ribsState.showVendorManager ? '▴' : '▾'}
          </button>
        </div>

        ${ribsState.showVendorManager ? `
          <div class="px-3.5 pb-3.5 pt-2.5 border-t border-slate-100 space-y-2.5 bg-slate-50/40">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              ${vendorRowsHtml}
            </div>
            <div class="flex items-center gap-1.5 pt-2 border-t border-slate-200/70 flex-wrap sm:flex-nowrap">
              <input
                id="ribNewVendorName"
                type="text"
                placeholder="업체명 (예: 우가원정육점)"
                class="flex-1 min-w-[110px] px-3 py-2 rounded-xl border border-slate-200 bg-white focus:border-[#B30E2A] outline-none text-xs font-bold"
              />
              <input
                id="ribNewVendorRegion"
                type="text"
                placeholder="지역 (예: 전주)"
                class="flex-1 min-w-[90px] px-3 py-2 rounded-xl border border-slate-200 bg-white focus:border-[#B30E2A] outline-none text-xs font-bold"
              />
              <button
                type="button"
                data-rib-add-vendor="1"
                class="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold cursor-pointer transition whitespace-nowrap shrink-0"
              >
                + 등록
              </button>
            </div>
            <p class="text-[11px] text-slate-400 font-medium">
              ※ 등록된 업체는 [배송 공지] 자동 지역 매칭과 [짝갈비 발주] 업체 선택에 공통으로 적용됩니다.
            </p>
          </div>
        ` : ''}
      </section>
    `;
  }

  // =========================================================
  // 렌더링: 탭 1 [배송 공지] (기존 기능 100% 유지 + 컴팩트)
  // =========================================================
  function renderNoticeTabHtml() {
    const previewText = ribsState.draftText.trim() ? applyVendorRegions(ribsState.draftText) : '';
    const isEditing = !!ribsState.editingNoticeId;

    const composerHtml = `
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3.5 sm:p-4 space-y-2.5">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 class="text-sm font-extrabold text-slate-900">${isEditing ? '✏️ 짝갈비 배송 공지 수정' : '🥩 짝갈비 배송 공지 작성'}</h2>
            <p class="text-[11px] font-medium text-slate-500 mt-0.5">업체명: 도체번호 형식으로 붙여넣으면 (지역)이 자동 매칭됩니다.</p>
          </div>
          ${isEditing ? `
            <button
              type="button"
              data-rib-cancel-edit="1"
              class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-extrabold cursor-pointer transition"
            >
              수정 취소
            </button>
          ` : ''}
        </div>

        <textarea
          id="ribDraftTextarea"
          rows="5"
          placeholder="예시)&#10;금일 짝갈비&#10;- 초우: 33,35,36,39&#10;- 민축산: 28,38,120&#10;  38번 안창제거 18700"
          class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] focus:ring-2 focus:ring-[#B30E2A]/15 outline-none text-sm font-medium resize-y leading-relaxed"
        >${esc(ribsState.draftText)}</textarea>

        ${previewText ? `
          <div id="ribLivePreviewBox" class="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold text-emerald-800">✅ 지역 자동 매칭 미리보기</span>
              <span class="text-[10px] font-bold text-emerald-600">도체번호 · 메모 그대로 유지</span>
            </div>
            <pre class="text-xs sm:text-sm font-semibold text-slate-800 whitespace-pre-wrap break-words font-sans leading-relaxed">${esc(previewText)}</pre>
          </div>
        ` : ''}

        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-[11px] font-bold text-slate-500">등록 시 전 직원에게 '짝갈비 배송 업데이트' 푸시 발송</span>
          <button
            type="button"
            data-rib-submit="1"
            class="px-4 py-2.5 rounded-xl bg-[#B30E2A] hover:bg-[#960B22] active:scale-[0.98] text-white text-xs font-extrabold shadow-md shadow-[#B30E2A]/20 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            ${isEditing ? '수정 완료 및 푸시 발송' : '지역 적용 후 공지 등록'}
          </button>
        </div>
      </section>
    `;

    const noticesHtml = (ribsState.notices || []).length === 0
      ? `
        <div class="bg-white rounded-2xl border border-slate-200/80 py-10 px-4 text-center">
          <p class="text-sm font-bold text-slate-400">등록된 짝갈비 배송 공지가 없습니다.</p>
        </div>
      `
      : ribsState.notices.map(function (item) {
          const metaText = item.updatedAt
            ? `${formatDateTime(item.createdAt)} · 수정 ${item.updatedBy || ''} (${formatDateTime(item.updatedAt)})`
            : formatDateTime(item.createdAt);
          return `
            <article class="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3.5 sm:p-4 space-y-2.5">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="px-2 py-0.5 rounded-md bg-[#B30E2A]/10 text-[#B30E2A] text-[11px] font-extrabold">짝갈비 배송</span>
                  <span class="text-xs font-extrabold text-slate-900">${esc(item.authorName)}</span>
                  <span class="text-[11px] font-semibold text-slate-400">${esc(metaText)}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button type="button" data-rib-copy="${esc(item.id)}" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-extrabold cursor-pointer transition">복사</button>
                  <button type="button" data-rib-edit="${esc(item.id)}" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-extrabold cursor-pointer transition">수정</button>
                  <button type="button" data-rib-delete="${esc(item.id)}" class="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-extrabold cursor-pointer transition">삭제</button>
                </div>
              </div>
              <pre class="text-sm font-semibold text-slate-800 whitespace-pre-wrap break-words font-sans leading-relaxed bg-slate-50/80 rounded-xl p-3 border border-slate-100">${esc(item.content)}</pre>
            </article>
          `;
        }).join('');

    return composerHtml + `<div class="space-y-3">${noticesHtml}</div>`;
  }

  // =========================================================
  // 렌더링: 탭 2 [짝갈비 발주] (신규 추가)
  // =========================================================
  function renderOrderTabHtml() {
    const isEditing = !!ribsState.editingOrderId;
    const sortedOrders = getSortedOrders();
    const pendingCount = sortedOrders.filter(function (o) { return !o.done; }).length;
    const doneCount = sortedOrders.length - pendingCount;

    const selectedDayList = String(ribsState.orderDays || '')
      .split('/')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    const vendorOptionsHtml = '<option value="">등록된 업체 선택...</option>' +
      (ribsState.vendors || []).map(function (v) {
        const label = `${v.name}(${v.region})`;
        return `<option value="${esc(label)}">${esc(label)}</option>`;
      }).join('');

    const weekdayBtnsHtml = WEEKDAYS.map(function (day) {
      const active = selectedDayList.includes(day);
      return `
        <button
          type="button"
          data-rib-order-day="${day}"
          class="px-2.5 py-1.5 rounded-lg border text-xs font-extrabold cursor-pointer transition ${active ? 'bg-[#B30E2A] text-white border-[#B30E2A] shadow-xs' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}"
        >${day}</button>
      `;
    }).join('');

    const gradeBtnsHtml = RIB_GRADES.map(function (g) {
      const active = ribsState.orderGrade === g;
      return `
        <button
          type="button"
          data-rib-order-grade="${esc(g)}"
          class="px-2.5 py-1.5 rounded-lg border text-xs font-extrabold cursor-pointer transition ${active ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}"
        >${esc(g)}</button>
      `;
    }).join('');

    // 발주 입력 폼 카드
    const orderFormHtml = `
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3.5 sm:p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h2 class="text-sm font-extrabold text-slate-900">${isEditing ? '✏️ 짝갈비 발주 수정' : '📝 짝갈비 발주 입력'}</h2>
          ${isEditing ? `
            <button type="button" data-rib-order-cancel="1" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-extrabold cursor-pointer">수정 취소</button>
          ` : ''}
        </div>

        <!-- 1. 업체명 (직접 입력 + 등록 업체 선택) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label for="ribOrderVendorInput" class="block text-[11px] font-bold text-slate-500 mb-1">업체명 (지역 자동 매칭)</label>
            <input
              id="ribOrderVendorInput"
              type="text"
              value="${esc(ribsState.orderVendor)}"
              placeholder="예: 우가원정육점(전주) 또는 초우"
              class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-xs sm:text-sm font-bold"
            />
          </div>
          <div>
            <label for="ribOrderVendorSelect" class="block text-[11px] font-bold text-slate-500 mb-1">등록 업체 빠른 선택</label>
            <select
              id="ribOrderVendorSelect"
              class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:border-[#B30E2A] outline-none text-xs sm:text-sm font-bold text-slate-700 cursor-pointer"
            >
              ${vendorOptionsHtml}
            </select>
          </div>
        </div>

        <!-- 2. 배송 요일 (간편 선택 + 직접 입력) -->
        <div>
          <label for="ribOrderDaysInput" class="block text-[11px] font-bold text-slate-500 mb-1">배송 요일</label>
          <div class="flex items-center gap-1.5 flex-wrap">
            <div class="flex items-center gap-1">${weekdayBtnsHtml}</div>
            <input
              id="ribOrderDaysInput"
              type="text"
              value="${esc(ribsState.orderDays)}"
              placeholder="직접 입력 (예: 화/목)"
              class="flex-1 min-w-[120px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-xs font-bold"
            />
          </div>
        </div>

        <!-- 3. 희망 등급 + 수량 -->
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2.5 items-end">
          <div>
            <label class="block text-[11px] font-bold text-slate-500 mb-1">희망 등급</label>
            <div class="flex items-center gap-1 flex-wrap">${gradeBtnsHtml}</div>
          </div>
          <div>
            <label for="ribOrderQtyInput" class="block text-[11px] font-bold text-slate-500 mb-1">수량</label>
            <div class="flex items-center rounded-xl border border-slate-200 bg-slate-50/70 focus-within:bg-white focus-within:border-[#B30E2A] overflow-hidden">
              <input
                id="ribOrderQtyInput"
                type="text"
                inputmode="decimal"
                value="${esc(ribsState.orderQty)}"
                placeholder="2"
                class="w-full px-3 py-2 bg-transparent outline-none text-sm font-extrabold text-center text-slate-900"
              />
              <span class="px-3 py-2 bg-slate-100 border-l border-slate-200 text-xs font-extrabold text-slate-700 shrink-0">짝</span>
            </div>
          </div>
        </div>

        <!-- 4. 대체 조건 / 비고 -->
        <div>
          <label for="ribOrderNoteInput" class="block text-[11px] font-bold text-slate-500 mb-1">대체 조건 / 비고 <span class="text-slate-400 font-normal">(선택)</span></label>
          <input
            id="ribOrderNoteInput"
            type="text"
            value="${esc(ribsState.orderNote)}"
            placeholder="예: 없으면 1++8 까지, 안창제거 등"
            class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-xs sm:text-sm font-medium"
          />
        </div>

        <div class="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <span class="text-[11px] font-bold text-slate-400">등록 시 근무 중인 직원에게 푸시 알림 발송</span>
          <button
            type="button"
            data-rib-order-submit="1"
            class="px-4 py-2.5 rounded-xl bg-[#B30E2A] hover:bg-[#960B22] active:scale-[0.98] text-white text-xs font-extrabold shadow-md shadow-[#B30E2A]/20 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            ${isEditing ? '발주 수정 저장' : '짝갈비 발주 등록'}
          </button>
        </div>
      </section>
    `;

    // 발주 리스트 상단 액션 바 (건수 + 전체 발주 카톡 복사)
    const listToolbarHtml = `
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-xs font-extrabold text-slate-800">발주 현황</span>
          <span class="px-2 py-0.5 rounded-full bg-red-50 text-[#B30E2A] text-[11px] font-extrabold">미배정 ${pendingCount}건</span>
          ${doneCount > 0 ? `<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-extrabold">완료 ${doneCount}건</span>` : ''}
        </div>
        <button
          type="button"
          data-rib-order-copy-all="1"
          class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-900 text-xs font-extrabold cursor-pointer transition whitespace-nowrap"
        >
          💬 전체 발주 카톡 복사
        </button>
      </div>
    `;

    // 발주 카드 리스트
    const orderCardsHtml = sortedOrders.length === 0
      ? `
        <div class="bg-white rounded-2xl border border-slate-200/80 py-10 px-4 text-center">
          <p class="text-sm font-bold text-slate-400">등록된 짝갈비 발주 내역이 없습니다.</p>
        </div>
      `
      : sortedOrders.map(function (ord) {
          const isDone = !!ord.done;
          return `
            <article class="rounded-2xl border shadow-sm p-3.5 sm:p-4 space-y-2.5 transition ${isDone ? 'bg-slate-50/90 border-slate-200/80 opacity-65' : 'bg-white border-slate-200/90'}">
              <!-- 카드 상단: 배정완료 체크 + 업체명(지역) + 배송요일 배지 + 복사/수정/삭제 -->
              <div class="flex items-start justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2 flex-wrap min-w-0">
                  <label class="inline-flex items-center gap-1.5 cursor-pointer select-none shrink-0" title="배정 완료 체크">
                    <input
                      type="checkbox"
                      data-rib-order-toggle-done="${esc(ord.id)}"
                      ${isDone ? 'checked' : ''}
                      class="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                    />
                  </label>
                  <h3 class="text-sm sm:text-base font-extrabold tracking-tight break-words ${isDone ? 'line-through text-slate-500' : 'text-slate-900'}">${esc(ord.vendor)}</h3>
                  ${ord.days ? `<span class="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-extrabold shrink-0">${esc(ord.days)}</span>` : ''}
                  ${isDone ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-extrabold shrink-0">✓ 배정 완료</span>' : ''}
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <button type="button" data-rib-order-copy="${esc(ord.id)}" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-extrabold cursor-pointer transition">복사</button>
                  <button type="button" data-rib-order-edit="${esc(ord.id)}" class="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-extrabold cursor-pointer transition">수정</button>
                  <button type="button" data-rib-order-delete="${esc(ord.id)}" class="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-extrabold cursor-pointer transition">삭제</button>
                </div>
              </div>

              <!-- 카드 중단 (핵심 강조): 등급 배지 + 수량 -->
              <div class="flex items-center justify-between gap-2 pt-0.5">
                <div class="flex items-center gap-2.5 flex-wrap">
                  <span class="px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold tracking-tight ${isDone ? 'bg-slate-400 text-white' : 'bg-[#B30E2A] text-white shadow-xs'}">${esc(ord.grade)} 등급</span>
                  <span class="text-lg sm:text-xl font-extrabold tracking-tight ${isDone ? 'line-through text-slate-400' : 'text-slate-900'}">${esc(formatQtyText(ord.qty))}</span>
                </div>
                <span class="text-[11px] font-semibold text-slate-400 shrink-0">${esc(ord.authorName || '')} · ${esc(formatDateTime(ord.createdAt))}</span>
              </div>

              <!-- 카드 하단: 대체 조건 / 비고 (있을 때만 표시) -->
              ${ord.note && ord.note.trim() ? `
                <div class="rounded-xl bg-slate-100/90 border border-slate-200/70 px-3 py-2 text-xs font-bold text-slate-700 leading-snug">
                  ※ ${esc(ord.note.trim())}
                </div>
              ` : ''}
            </article>
          `;
        }).join('');

    return orderFormHtml + listToolbarHtml + `<div class="space-y-2.5">${orderCardsHtml}</div>`;
  }

  function render() {
    const container = document.getElementById('ribsTabPanel');
    if (!container) return;

    const topHtml = renderTopHeaderHtml();
    const bodyHtml = ribsState.subTab === 'notice' ? renderNoticeTabHtml() : renderOrderTabHtml();
    container.innerHTML = topHtml + bodyHtml;
  }

  function bindContainerEvents() {
    const container = document.getElementById('ribsTabPanel');
    if (!container || ribsState.listenersBound) return;
    ribsState.listenersBound = true;

    container.addEventListener('click', function (e) {
      // 서브 탭 전환
      const subTabBtn = e.target.closest('[data-rib-subtab]');
      if (subTabBtn) {
        ribsState.subTab = subTabBtn.dataset.ribSubtab;
        render();
        return;
      }

      // 업체·지역 설정 펼치기/접기
      if (e.target.closest('[data-rib-toggle-vendors]')) {
        ribsState.showVendorManager = !ribsState.showVendorManager;
        render();
        return;
      }

      // 업체 추가
      if (e.target.closest('[data-rib-add-vendor]')) {
        const nameEl = document.getElementById('ribNewVendorName');
        const regionEl = document.getElementById('ribNewVendorRegion');
        const name = nameEl ? nameEl.value.trim() : '';
        const region = regionEl ? regionEl.value.trim() : '';
        const b = getBridge();
        if (!name || !region) {
          if (b) b.showToast('업체명과 지역을 모두 입력해 주세요.');
          return;
        }
        const nextList = ribsState.vendors.filter(function (v) { return v.name !== name; });
        nextList.push({
          id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          name: name,
          region: region
        });
        saveVendorsToDb(nextList, `'${name}(${region})' 등록 완료`);
        return;
      }

      // 업체 삭제
      const delVendorBtn = e.target.closest('[data-rib-del-vendor]');
      if (delVendorBtn) {
        const id = delVendorBtn.dataset.ribDelVendor;
        const nextList = ribsState.vendors.filter(function (v) { return v.id !== id; });
        saveVendorsToDb(nextList, '업체가 삭제되었습니다.');
        return;
      }

      // =================================================
      // [배송 공지] 이벤트
      // =================================================
      if (e.target.closest('[data-rib-submit]')) {
        submitRibsNotice();
        return;
      }

      if (e.target.closest('[data-rib-cancel-edit]')) {
        ribsState.editingNoticeId = null;
        ribsState.draftText = '';
        render();
        return;
      }

      const copyBtn = e.target.closest('[data-rib-copy]');
      if (copyBtn) {
        const id = copyBtn.dataset.ribCopy;
        const target = ribsState.notices.find(function (x) { return x.id === id; });
        if (target) copyToClipboard(target.content, '짝갈비 배송 내용이 복사되었습니다.');
        return;
      }

      const editBtn = e.target.closest('[data-rib-edit]');
      if (editBtn) {
        const id = editBtn.dataset.ribEdit;
        const target = ribsState.notices.find(function (x) { return x.id === id; });
        if (!target) return;
        ribsState.editingNoticeId = target.id;
        ribsState.draftText = target.content;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const delNoticeBtn = e.target.closest('[data-rib-delete]');
      if (delNoticeBtn) {
        const id = delNoticeBtn.dataset.ribDelete;
        const b = getBridge();
        const db = b ? b.getDb() : null;
        if (!db) return;
        const doDelete = function () {
          const nextList = ribsState.notices.filter(function (x) { return x.id !== id; });
          db.collection(COLLECTION).doc('notices').set({
            list: nextList,
            updatedAt: Date.now()
          }).then(function () {
            if (b) b.showToast('짝갈비 배송 공지가 삭제되었습니다.');
          });
        };
        if (b && typeof b.openConfirmModal === 'function') {
          b.openConfirmModal({
            title: '짝갈비 공지 삭제',
            message: '이 짝갈비 배송 공지를 삭제하시겠습니까?',
            okText: '삭제',
            cancelText: '취소',
            onConfirm: doDelete
          });
        } else {
          doDelete();
        }
        return;
      }

      // =================================================
      // [짝갈비 발주] 이벤트
      // =================================================
      // 배송 요일 간편 토글
      const dayBtn = e.target.closest('[data-rib-order-day]');
      if (dayBtn) {
        const day = dayBtn.dataset.ribOrderDay;
        const current = String(ribsState.orderDays || '')
          .split('/')
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
        const idx = current.indexOf(day);
        if (idx > -1) {
          current.splice(idx, 1);
        } else {
          current.push(day);
        }
        // 월~토 순서로 정렬
        current.sort(function (a, b) {
          const ia = WEEKDAYS.indexOf(a);
          const ib = WEEKDAYS.indexOf(b);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });
        ribsState.orderDays = current.join('/');
        render();
        return;
      }

      // 희망 등급 선택
      const gradeBtn = e.target.closest('[data-rib-order-grade]');
      if (gradeBtn) {
        ribsState.orderGrade = gradeBtn.dataset.ribOrderGrade;
        render();
        return;
      }

      // 발주 등록 / 수정 제출
      if (e.target.closest('[data-rib-order-submit]')) {
        submitRibsOrder();
        return;
      }

      // 발주 수정 취소
      if (e.target.closest('[data-rib-order-cancel]')) {
        resetOrderForm();
        render();
        return;
      }

      // 전체 발주 카톡 복사
      if (e.target.closest('[data-rib-order-copy-all]')) {
        copyToClipboard(buildAllOrdersCopyText(), '전체 짝갈비 발주 내역이 복사되었습니다.');
        return;
      }

      // 개별 발주 복사
      const copyOrderBtn = e.target.closest('[data-rib-order-copy]');
      if (copyOrderBtn) {
        const id = copyOrderBtn.dataset.ribOrderCopy;
        const found = ribsState.orders.find(function (o) { return o.id === id; });
        if (found) copyToClipboard(formatSingleOrderCopy(found), `'${found.vendor}' 발주 내용이 복사되었습니다.`);
        return;
      }

      // 개별 발주 수정
      const editOrderBtn = e.target.closest('[data-rib-order-edit]');
      if (editOrderBtn) {
        const id = editOrderBtn.dataset.ribOrderEdit;
        const found = ribsState.orders.find(function (o) { return o.id === id; });
        if (!found) return;
        ribsState.editingOrderId = found.id;
        ribsState.orderVendor = found.vendor || '';
        ribsState.orderDays = found.days || '';
        ribsState.orderGrade = found.grade || '1++9';
        ribsState.orderQty = String(found.qty || '1').replace(/짝$/g, '');
        ribsState.orderNote = found.note || '';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // 개별 발주 삭제
      const delOrderBtn = e.target.closest('[data-rib-order-delete]');
      if (delOrderBtn) {
        const id = delOrderBtn.dataset.ribOrderDelete;
        const found = ribsState.orders.find(function (o) { return o.id === id; });
        if (!found) return;
        const b = getBridge();
        const doDel = function () {
          const nextOrders = ribsState.orders.filter(function (o) { return o.id !== id; });
          if (ribsState.editingOrderId === id) resetOrderForm();
          saveOrdersToDb(nextOrders, `'${found.vendor}' 발주가 삭제되었습니다.`, null);
        };
        if (b && typeof b.openConfirmModal === 'function') {
          b.openConfirmModal({
            title: '짝갈비 발주 삭제',
            message: `'${found.vendor}' 발주를 삭제하시겠습니까?`,
            okText: '삭제',
            cancelText: '취소',
            onConfirm: doDel
          });
        } else {
          doDel();
        }
      }
    });

    container.addEventListener('change', function (e) {
      const target = e.target;
      if (!target) return;

      // 등록 업체 빠른 선택 드롭다운
      if (target.id === 'ribOrderVendorSelect' && target.value) {
        ribsState.orderVendor = target.value;
        const vendorInput = document.getElementById('ribOrderVendorInput');
        if (vendorInput) vendorInput.value = target.value;
        target.value = '';
        return;
      }

      // 배정 완료 체크박스 토글
      if (target.dataset.ribOrderToggleDone) {
        const id = target.dataset.ribOrderToggleDone;
        const checked = !!target.checked;
        const nextOrders = ribsState.orders.map(function (ord) {
          if (ord.id !== id) return ord;
          return Object.assign({}, ord, { done: checked });
        });
        saveOrdersToDb(nextOrders, checked ? '배정 완료 처리되었습니다.' : '배정 완료가 해제되었습니다.', null);
      }
    });

    container.addEventListener('input', function (e) {
      const target = e.target;
      if (!target) return;

      if (target.id === 'ribDraftTextarea') {
        ribsState.draftText = target.value;
        const previewText = ribsState.draftText.trim() ? applyVendorRegions(ribsState.draftText) : '';
        const section = target.closest('section');
        if (!section) return;
        let previewBox = section.querySelector('#ribLivePreviewBox');
        if (previewText) {
          if (!previewBox) {
            previewBox = document.createElement('div');
            previewBox.id = 'ribLivePreviewBox';
            previewBox.className = 'rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 space-y-1.5';
            target.insertAdjacentElement('afterend', previewBox);
          }
          previewBox.innerHTML = `
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold text-emerald-800">✅ 지역 자동 매칭 미리보기</span>
              <span class="text-[10px] font-bold text-emerald-600">도체번호 · 메모 그대로 유지</span>
            </div>
            <pre class="text-xs sm:text-sm font-semibold text-slate-800 whitespace-pre-wrap break-words font-sans leading-relaxed">${esc(previewText)}</pre>
          `;
        } else if (previewBox) {
          previewBox.remove();
        }
        return;
      }

      if (target.id === 'ribOrderVendorInput') {
        ribsState.orderVendor = target.value;
      } else if (target.id === 'ribOrderDaysInput') {
        ribsState.orderDays = target.value;
      } else if (target.id === 'ribOrderQtyInput') {
        ribsState.orderQty = target.value;
      } else if (target.id === 'ribOrderNoteInput') {
        ribsState.orderNote = target.value;
      }
    });
  }

  function init() {
    if (ribsState.initialized) return;
    ribsState.initialized = true;
    bindContainerEvents();
    initFirestoreSync();
    render();
  }

  window.MinsokRibs = {
    init: init,
    render: render
  };
})();
