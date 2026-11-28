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

  const ribsState = {
    vendors: DEFAULT_VENDORS.slice(),
    notices: [], // 최신순 짝갈비 공지 목록
    draftText: '',
    editingNoticeId: null,
    showVendorManager: false,
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

  /**
   * 짝갈비 텍스트 자동 업체-지역 매칭 변환
   * 예: "- 초우: 33,35,36,39" -> "- 초우(서울): 33,35,36,39"
   * 예: "- 동선(토): 26,30" -> "- 동선(토)(해운대): 26,30"
   * 이미 "(지역)"이 붙어 있는 경우 중복 추가하지 않음
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
      const rightPart = line.slice(colonIdx); // ":" 포함 도체번호 영역

      // 앞쪽 기호(-, •, 공백, 제로폭 공백 등) 분리
      const match = leftPart.match(/^([\s\u200B-\u200D\uFEFF\-•*]*)(.+?)(\s*)$/);
      if (!match) return line;

      const prefix = match[1];
      const rawVendorLabel = match[2].trim();
      const suffixSpace = match[3];

      // 괄호 앞의 순수 업체명 추출 (예: "동선(토)" -> "동선", "초우(서울)" -> "초우")
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
      // 이미 해당 지역 태그가 붙어 있으면 그대로 유지
      if (rawVendorLabel.includes(regionTag)) {
        return line;
      }

      return `${prefix}${rawVendorLabel}${regionTag}${suffixSpace}${rightPart}`;
    });

    return converted.join('\n');
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

    // 2. 짝갈비 공지 목록 실시간 동기화
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
      const newNotice = {
        id: 'rib_' + now + '_' + Math.random().toString(36).slice(2, 6),
        content: formatted,
        authorName: user.name,
        createdAt: now,
        updatedAt: null,
        updatedBy: null
      };
      nextNotices.unshift(newNotice);
    }

    // 최근 30건만 유지하여 DB 용량 절약
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

  function render() {
    const container = document.getElementById('ribsTabPanel');
    if (!container) return;

    const previewText = ribsState.draftText.trim() ? applyVendorRegions(ribsState.draftText) : '';
    const isEditing = !!ribsState.editingNoticeId;

    // 1. 업체-지역 관리 영역
    const vendorRowsHtml = (ribsState.vendors || []).map(function (v) {
      return `
        <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-xs font-extrabold text-slate-900 truncate">${esc(v.name)}</span>
            <span class="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-extrabold shrink-0">${esc(v.region)}</span>
          </div>
          <button
            type="button"
            data-rib-del-vendor="${esc(v.id)}"
            class="w-6 h-6 rounded-lg bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-400 hover:text-red-600 text-[11px] font-bold cursor-pointer transition shrink-0"
            title="삭제"
          >✕</button>
        </div>
      `;
    }).join('');

    const vendorSectionHtml = `
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <button
          type="button"
          data-rib-toggle-vendors="1"
          class="w-full px-4 py-3 flex items-center justify-between gap-2 bg-slate-50/70 hover:bg-slate-100/70 transition cursor-pointer"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-extrabold text-slate-900">🏢 업체 · 지역 설정</span>
            <span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-extrabold">${ribsState.vendors.length}개 등록</span>
          </div>
          <span class="text-xs font-extrabold text-slate-500">${ribsState.showVendorManager ? '접기 ▴' : '펼쳐서 관리 ▾'}</span>
        </button>

        ${ribsState.showVendorManager ? `
          <div class="p-4 border-t border-slate-100 space-y-3">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              ${vendorRowsHtml}
            </div>
            <div class="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap sm:flex-nowrap">
              <input
                id="ribNewVendorName"
                type="text"
                placeholder="업체명 (예: 초우)"
                class="flex-1 min-w-[110px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-xs font-bold"
              />
              <input
                id="ribNewVendorRegion"
                type="text"
                placeholder="지역 (예: 서울)"
                class="flex-1 min-w-[110px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-xs font-bold"
              />
              <button
                type="button"
                data-rib-add-vendor="1"
                class="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold cursor-pointer transition whitespace-nowrap shrink-0"
              >
                + 추가
              </button>
            </div>
            <p class="text-[11px] text-slate-400 font-medium">
              ※ 같은 업체명을 다시 추가하면 지역이 새 값으로 수정됩니다. (예: 동선 → 해운대 등록 시 '동선(토): 26,30'도 자동으로 '동선(토)(해운대): 26,30' 변환)
            </p>
          </div>
        ` : ''}
      </section>
    `;

    // 2. 작성 / 자동 변환 미리보기 영역
    const composerHtml = `
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3">
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
          rows="7"
          placeholder="예시)&#10;금일 짝갈비&#10;&#10;- 초우: 33,35,36,39&#10;- 민축산: 28,38,120&#10;  38번 안창제거 18700&#10;- 동선(토): 26,30"
          class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] focus:ring-2 focus:ring-[#B30E2A]/15 outline-none text-sm font-medium resize-y leading-relaxed"
        >${esc(ribsState.draftText)}</textarea>

        ${previewText ? `
          <div class="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 space-y-1.5">
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

    // 3. 등록된 짝갈비 공지 목록
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
            <article class="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="px-2 py-0.5 rounded-md bg-[#B30E2A]/10 text-[#B30E2A] text-[11px] font-extrabold">짝갈비 배송</span>
                  <span class="text-xs font-extrabold text-slate-900">${esc(item.authorName)}</span>
                  <span class="text-[11px] font-semibold text-slate-400">${esc(metaText)}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-rib-copy="${esc(item.id)}"
                    class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-extrabold cursor-pointer transition"
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    data-rib-edit="${esc(item.id)}"
                    class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-extrabold cursor-pointer transition"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    data-rib-delete="${esc(item.id)}"
                    class="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-extrabold cursor-pointer transition"
                  >
                    삭제
                  </button>
                </div>
              </div>
              <pre class="text-sm font-semibold text-slate-800 whitespace-pre-wrap break-words font-sans leading-relaxed bg-slate-50/80 rounded-xl p-3 border border-slate-100">${esc(item.content)}</pre>
            </article>
          `;
        }).join('');

    container.innerHTML = vendorSectionHtml + composerHtml + `<div class="space-y-3">${noticesHtml}</div>`;
  }

  function bindContainerEvents() {
    const container = document.getElementById('ribsTabPanel');
    if (!container || ribsState.listenersBound) return;
    ribsState.listenersBound = true;

    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-rib-toggle-vendors]')) {
        ribsState.showVendorManager = !ribsState.showVendorManager;
        render();
        return;
      }

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

      const delVendorBtn = e.target.closest('[data-rib-del-vendor]');
      if (delVendorBtn) {
        const id = delVendorBtn.dataset.ribDelVendor;
        const nextList = ribsState.vendors.filter(function (v) { return v.id !== id; });
        saveVendorsToDb(nextList, '업체가 삭제되었습니다.');
        return;
      }

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
        const b = getBridge();
        if (target && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(target.content).then(function () {
            if (b) b.showToast('짝갈비 배송 내용이 복사되었습니다.');
          }).catch(function () {});
        }
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
      }
    });

    container.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'ribDraftTextarea') {
        ribsState.draftText = e.target.value;
        // 커서 위치 유지를 위해 미리보기 영역만 동적 갱신
        const previewText = ribsState.draftText.trim() ? applyVendorRegions(ribsState.draftText) : '';
        const section = e.target.closest('section');
        if (!section) return;
        let previewBox = section.querySelector('#ribLivePreviewBox');
        if (previewText) {
          if (!previewBox) {
            previewBox = document.createElement('div');
            previewBox.id = 'ribLivePreviewBox';
            previewBox.className = 'rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 space-y-1.5';
            e.target.insertAdjacentElement('afterend', previewBox);
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
