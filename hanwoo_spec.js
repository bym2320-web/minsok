(function () {
  'use strict';

  const COLLECTION = 'hanwooSpecs';

  const FIXED_CUTS = [
    '안심', '등심', '채끝', '양지', '설도', '앞다리', '사태',
    '우둔', '목심', '스지/도가니', '차돌', '반골꼬리', '잡뼈', '갈비'
  ];

  const GRADES = ['1++(9)', '1++(8)', '1++(7)', '1+', '1등급', '2등급', '기타'];

  function getTodayKey() {
    const b = window.MinsokBridge;
    if (b && typeof b.getDateKey === 'function') return b.getDateKey();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function createDefaultSpecs() {
    const specs = {};
    FIXED_CUTS.forEach(function (cut) {
      specs[cut] = '정상';
    });
    return specs;
  }

  function createEmptyOrderItem() {
    return {
      id: 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      grade: '1++(9)',
      partName: '',
      qty: '',
      note: '',
      done: false
    };
  }

  const hsState = {
    selectedDate: getTodayKey(),
    subTab: 'spec', // 'spec' | 'order'
    specs: createDefaultSpecs(),
    orders: [], // [{ id, vendor, items: [{ id, grade, partName, qty, note, done }], createdAt, authorName }]
    updatedAt: null,
    updatedBy: null,

    // 스펙 편집 상태
    editingCut: null,
    editingCutText: '',

    // 발주 입력 폼 상태
    editingOrderId: null,
    formVendor: '',
    formItems: [createEmptyOrderItem()],

    unsubscribe: null,
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

  function hasAccess() {
    const b = getBridge();
    if (!b || typeof b.getCurrentUser !== 'function') return false;
    const u = b.getCurrentUser();
    if (!u) return false;
    const part = typeof b.normalizePartName === 'function' ? b.normalizePartName(u.part) : (u.part || '');
    return u.isAdmin === true || part === '한우정리';
  }

  function formatDateKo(dateKey) {
    const parts = String(dateKey).split('-').map(Number);
    const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    const wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${parts[1]}/${parts[2]}(${wk})`;
  }

  function formatUpdated(ts, by) {
    if (!ts) return '저장 기록 없음';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `최종 수정 ${hh}:${mm}${by ? ` (${by})` : ''}`;
  }

  function isSpecialSpec(val) {
    const t = String(val || '').trim();
    return t !== '' && t !== '정상';
  }

  function subscribeDateDoc(dateKey) {
    if (typeof hsState.unsubscribe === 'function') {
      hsState.unsubscribe();
      hsState.unsubscribe = null;
    }
    const b = getBridge();
    if (!b) return;
    const db = b.getDb();
    if (!db) return;

    hsState.unsubscribe = db.collection(COLLECTION).doc(dateKey).onSnapshot(function (doc) {
      if (doc.exists) {
        const data = doc.data() || {};
        const mergedSpecs = createDefaultSpecs();
        if (data.specs) {
          FIXED_CUTS.forEach(function (cut) {
            if (data.specs[cut] != null && String(data.specs[cut]).trim() !== '') {
              mergedSpecs[cut] = String(data.specs[cut]);
            }
          });
        }
        hsState.specs = mergedSpecs;
        hsState.orders = Array.isArray(data.orders) ? data.orders : [];
        hsState.updatedAt = data.updatedAt || null;
        hsState.updatedBy = data.updatedBy || null;
      } else {
        hsState.specs = createDefaultSpecs();
        hsState.orders = [];
        hsState.updatedAt = null;
        hsState.updatedBy = null;
      }
      render();
    }, function (err) {
      console.error('hanwooSpecs onSnapshot 오류:', err);
    });
  }

  function saveDoc(nextSpecs, nextOrders, toastMsg, pushTitle, pushBody) {
    const b = getBridge();
    if (!b || !hasAccess()) return;
    const db = b.getDb();
    const user = b.getCurrentUser();
    if (!db || !user) return;

    const payload = {
      dateKey: hsState.selectedDate,
      specs: nextSpecs,
      orders: nextOrders,
      updatedAt: Date.now(),
      updatedBy: user.name
    };

    db.collection(COLLECTION).doc(hsState.selectedDate).set(payload)
      .then(function () {
        if (toastMsg) b.showToast(toastMsg);
        if (pushTitle && typeof b.sendFcmPushForHanwooSpec === 'function') {
          b.sendFcmPushForHanwooSpec(pushTitle, pushBody, user.name);
        }
      })
      .catch(function (err) {
        console.error('hanwooSpecs 저장 오류:', err);
        b.showToast('저장 중 오류가 발생했습니다.');
      });
  }

  function copyText(text, successMsg) {
    const b = getBridge();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (b) b.showToast(successMsg);
      }).catch(function () {
        if (b) b.showToast('복사에 실패했습니다.');
      });
    }
  }

  function buildSpecCopyText() {
    const lines = [`[${formatDateKo(hsState.selectedDate)} 한우 당일 가공 스펙]`, ''];
    const specials = [];
    const normals = [];
    FIXED_CUTS.forEach(function (cut) {
      const val = (hsState.specs[cut] || '정상').trim();
      if (isSpecialSpec(val)) {
        specials.push(`★ ${cut}: ${val}`);
      } else {
        normals.push(cut);
      }
    });

    if (specials.length > 0) {
      lines.push('■ 특이사항');
      specials.forEach(function (s) { lines.push(s); });
      lines.push('');
    }
    if (normals.length > 0) {
      lines.push(`■ 정상 (${normals.length}개 부위)`);
      lines.push(normals.join(', '));
    }
    return lines.join('\n');
  }

  function buildOrderCopyText() {
    const lines = [`[${formatDateKo(hsState.selectedDate)} 한우 당일 생산분 발주]`, ''];
    if (!hsState.orders || hsState.orders.length === 0) {
      lines.push('등록된 발주 내역이 없습니다.');
      return lines.join('\n');
    }
    hsState.orders.forEach(function (ord) {
      lines.push(`■ ${ord.vendor}`);
      (ord.items || []).forEach(function (it) {
        const check = it.done ? '[완료] ' : '- ';
        const parts = [it.grade, it.partName, it.qty].filter(Boolean).join(' ');
        const noteStr = it.note ? ` (${it.note})` : '';
        lines.push(`  ${check}${parts}${noteStr}`);
      });
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function renderSpecTabHtml() {
    const specialCount = FIXED_CUTS.filter(function (c) { return isSpecialSpec(hsState.specs[c]); }).length;

    const cardsHtml = FIXED_CUTS.map(function (cut) {
      const val = (hsState.specs[cut] || '정상').trim();
      const special = isSpecialSpec(val);
      const isEditing = hsState.editingCut === cut;

      if (isEditing) {
        return `
          <div class="col-span-full rounded-2xl border-2 border-[#B30E2A] bg-red-50/30 p-3.5 space-y-2.5 shadow-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-extrabold text-[#B30E2A]">✏️ ${esc(cut)} 스펙 수정</span>
              <div class="flex items-center gap-1.5">
                <button type="button" data-hs-set-normal="${esc(cut)}" class="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-extrabold cursor-pointer">정상으로</button>
                <button type="button" data-hs-cancel-cut="1" class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-bold cursor-pointer">취소</button>
              </div>
            </div>
            <textarea
              id="hsCutEditInput"
              rows="2"
              placeholder="특이사항 입력 (예: 30,39,40번 아랫등심 소분 / 1++ 아롱상박 외 냉동)"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white focus:border-[#B30E2A] outline-none text-sm font-semibold resize-none"
            >${esc(hsState.editingCutText)}</textarea>
            <div class="flex justify-end">
              <button
                type="button"
                data-hs-save-cut="${esc(cut)}"
                class="px-4 py-2 rounded-xl bg-[#B30E2A] hover:bg-[#960B22] text-white text-xs font-extrabold cursor-pointer shadow-xs transition"
              >
                저장 및 알림 발송
              </button>
            </div>
          </div>
        `;
      }

      if (special) {
        return `
          <button
            type="button"
            data-hs-edit-cut="${esc(cut)}"
            class="text-left rounded-2xl border-2 border-[#B30E2A] bg-red-50/60 hover:bg-red-50 p-3 space-y-1.5 shadow-xs transition cursor-pointer"
          >
            <div class="flex items-center justify-between gap-1.5">
              <span class="text-sm font-extrabold text-slate-900">${esc(cut)}</span>
              <span class="px-2 py-0.5 rounded-full bg-[#B30E2A] text-white text-[10px] font-extrabold shrink-0">특이사항</span>
            </div>
            <p class="text-xs font-bold text-[#960B22] whitespace-pre-wrap break-words leading-snug">${esc(val)}</p>
          </button>
        `;
      }

      return `
        <button
          type="button"
          data-hs-edit-cut="${esc(cut)}"
          class="text-left rounded-2xl border border-emerald-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30 p-3 space-y-1 shadow-xs transition cursor-pointer"
        >
          <div class="flex items-center justify-between gap-1.5">
            <span class="text-sm font-extrabold text-slate-900">${esc(cut)}</span>
            <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-extrabold shrink-0">정상</span>
          </div>
          <p class="text-[11px] font-medium text-emerald-700/70">터치하여 특이사항 입력</p>
        </button>
      `;
    }).join('');

    return `
      <!-- 스펙 상단 액션 바 -->
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-xs font-extrabold text-slate-700">14개 고정 부위</span>
          <span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold ${specialCount > 0 ? 'bg-red-100 text-[#B30E2A]' : 'bg-slate-100 text-slate-500'}">
            특이사항 ${specialCount}건
          </span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            data-hs-copy-spec="1"
            class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-900 text-xs font-extrabold cursor-pointer transition whitespace-nowrap"
          >
            💬 스펙 카톡 복사
          </button>
          <button
            type="button"
            data-hs-reset-all="1"
            class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold cursor-pointer transition whitespace-nowrap"
          >
            전체 정상 초기화
          </button>
        </div>
      </div>

      <!-- 14개 부위 카드 그리드 -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        ${cardsHtml}
      </div>
    `;
  }

  function renderOrderTabHtml() {
    const isEditing = !!hsState.editingOrderId;

    // 발주 입력 폼의 품목 행들
    const formRowsHtml = hsState.formItems.map(function (it, idx) {
      const gradeOpts = GRADES.map(function (g) {
        return `<option value="${esc(g)}" ${it.grade === g ? 'selected' : ''}>${esc(g)}</option>`;
      }).join('');

      return `
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-extrabold text-slate-500">품목 #${idx + 1}</span>
            ${hsState.formItems.length > 1 ? `
              <button type="button" data-hs-remove-form-item="${idx}" class="text-[11px] font-bold text-red-500 hover:text-red-700 cursor-pointer">삭제</button>
            ` : ''}
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select data-hs-form-idx="${idx}" data-hs-form-field="grade" class="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 outline-none">
              ${gradeOpts}
            </select>
            <input type="text" data-hs-form-idx="${idx}" data-hs-form-field="partName" value="${esc(it.partName)}" placeholder="부위/품목 (예: 정육)" class="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold outline-none" />
            <input type="text" data-hs-form-idx="${idx}" data-hs-form-field="qty" value="${esc(it.qty)}" placeholder="수량 (예: 3마리, 1두)" class="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold outline-none" />
            <input type="text" data-hs-form-idx="${idx}" data-hs-form-field="note" value="${esc(it.note)}" placeholder="비고/단가 (예: 32000)" class="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium outline-none" />
          </div>
        </div>
      `;
    }).join('');

    // 거래처별 발주 카드 목록
    const orderCardsHtml = hsState.orders.length === 0
      ? `
        <div class="bg-white rounded-2xl border border-slate-200/80 py-10 px-4 text-center">
          <p class="text-sm font-bold text-slate-400">등록된 당일 생산분 발주가 없습니다.</p>
        </div>
      `
      : hsState.orders.map(function (ord) {
          const items = ord.items || [];
          const allDone = items.length > 0 && items.every(function (x) { return !!x.done; });

          const itemsHtml = items.map(function (it) {
            return `
              <label class="flex items-start gap-2.5 p-2.5 rounded-xl border transition cursor-pointer ${it.done ? 'bg-slate-50 border-slate-200/60 opacity-55' : 'bg-white border-slate-200 hover:bg-slate-50/70'}">
                <input
                  type="checkbox"
                  data-hs-toggle-item-done="1"
                  data-hs-order-id="${esc(ord.id)}"
                  data-hs-item-id="${esc(it.id)}"
                  ${it.done ? 'checked' : ''}
                  class="mt-0.5 w-4 h-4 rounded accent-emerald-600 cursor-pointer shrink-0"
                />
                <div class="flex-1 min-w-0 ${it.done ? 'line-through text-slate-400' : 'text-slate-800'}">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-extrabold">${esc(it.grade)}</span>
                    <span class="text-xs sm:text-sm font-extrabold">${esc(it.partName)}</span>
                    ${it.qty ? `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-extrabold">${esc(it.qty)}</span>` : ''}
                  </div>
                  ${it.note ? `<p class="text-[11px] font-medium text-slate-500 mt-1">${esc(it.note)}</p>` : ''}
                </div>
              </label>
            `;
          }).join('');

          return `
            <article class="bg-white rounded-2xl border ${allDone ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200/90'} shadow-sm p-4 space-y-3">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  <h3 class="text-sm sm:text-base font-extrabold ${allDone ? 'line-through text-slate-400' : 'text-slate-900'}">${esc(ord.vendor)}</h3>
                  ${allDone ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-extrabold">작업 완료</span>' : ''}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button type="button" data-hs-edit-order="${esc(ord.id)}" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-extrabold cursor-pointer">수정</button>
                  <button type="button" data-hs-del-order="${esc(ord.id)}" class="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-extrabold cursor-pointer">삭제</button>
                </div>
              </div>
              <div class="space-y-1.5">${itemsHtml}</div>
            </article>
          `;
        }).join('');

    return `
      <!-- 발주 상단 액션 바 -->
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <span class="text-xs font-extrabold text-slate-700">거래처 발주 ${hsState.orders.length}건</span>
        <button
          type="button"
          data-hs-copy-order="1"
          class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-900 text-xs font-extrabold cursor-pointer transition whitespace-nowrap"
        >
          💬 발주 카톡 복사
        </button>
      </div>

      <!-- 발주 추가/수정 입력 폼 -->
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-extrabold text-slate-900">${isEditing ? '✏️ 거래처 발주 수정' : '➕ 거래처 발주 추가'}</h3>
          ${isEditing ? `<button type="button" data-hs-cancel-order="1" class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold cursor-pointer">수정 취소</button>` : ''}
        </div>

        <div>
          <label class="block text-[11px] font-bold text-slate-500 mb-1">거래처명</label>
          <input
            id="hsFormVendorInput"
            type="text"
            value="${esc(hsState.formVendor)}"
            placeholder="거래처명 입력 (예: 신포항(월), 베리(대전), 미사점, 배갈비)"
            class="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-sm font-bold"
          />
        </div>

        <div class="space-y-2">${formRowsHtml}</div>

        <div class="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <button
            type="button"
            data-hs-add-form-item="1"
            class="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-extrabold cursor-pointer transition"
          >
            + 품목 추가
          </button>
          <button
            type="button"
            data-hs-submit-order="1"
            class="px-4 py-2 rounded-xl bg-[#B30E2A] hover:bg-[#960B22] text-white text-xs font-extrabold shadow-sm cursor-pointer transition"
          >
            ${isEditing ? '발주 수정 저장' : '발주 등록 및 알림 발송'}
          </button>
        </div>
      </section>

      <!-- 거래처별 카드 목록 -->
      <div class="space-y-3">${orderCardsHtml}</div>
    `;
  }

  function render() {
    const container = document.getElementById('hanwooSpecTabPanel');
    if (!container) return;

    if (!hasAccess()) {
      container.innerHTML = '';
      return;
    }

    const isSpec = hsState.subTab === 'spec';

    const headerHtml = `
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3.5 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-sm font-extrabold text-slate-900">📋 한우 스펙&amp;발주</span>
            <span class="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-extrabold">관리자 · 한우정리 전용</span>
          </div>
          <span class="text-[11px] font-bold text-slate-400">${esc(formatUpdated(hsState.updatedAt, hsState.updatedBy))}</span>
        </div>

        <div class="flex items-center justify-between gap-2 flex-wrap">
          <!-- 내부 2개 탭 -->
          <div class="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
            <button
              type="button"
              data-hs-subtab="spec"
              class="px-3.5 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${isSpec ? 'bg-[#B30E2A] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
            >
              🔪 당일 가공 스펙
            </button>
            <button
              type="button"
              data-hs-subtab="order"
              class="px-3.5 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${!isSpec ? 'bg-[#B30E2A] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
            >
              📦 당일 생산분 발주
            </button>
          </div>

          <!-- 날짜 선택기 -->
          <div class="flex items-center gap-1.5">
            <input
              id="hsDateInput"
              type="date"
              value="${esc(hsState.selectedDate)}"
              class="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-extrabold text-slate-800 outline-none focus:border-[#B30E2A]"
            />
            <button
              type="button"
              data-hs-today="1"
              class="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-600 cursor-pointer"
            >
              오늘
            </button>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = headerHtml + (isSpec ? renderSpecTabHtml() : renderOrderTabHtml());
  }

  function bindEvents() {
    const container = document.getElementById('hanwooSpecTabPanel');
    if (!container || hsState.listenersBound) return;
    hsState.listenersBound = true;

    container.addEventListener('click', function (e) {
      const subBtn = e.target.closest('[data-hs-subtab]');
      if (subBtn) {
        hsState.subTab = subBtn.dataset.hsSubtab;
        render();
        return;
      }

      if (e.target.closest('[data-hs-today]')) {
        hsState.selectedDate = getTodayKey();
        hsState.editingCut = null;
        subscribeDateDoc(hsState.selectedDate);
        return;
      }

      // --- 스펙 이벤트 ---
      const editCutBtn = e.target.closest('[data-hs-edit-cut]');
      if (editCutBtn) {
        const cut = editCutBtn.dataset.hsEditCut;
        hsState.editingCut = cut;
        const cur = (hsState.specs[cut] || '정상').trim();
        hsState.editingCutText = cur === '정상' ? '' : cur;
        render();
        const input = document.getElementById('hsCutEditInput');
        if (input) input.focus();
        return;
      }

      if (e.target.closest('[data-hs-cancel-cut]')) {
        hsState.editingCut = null;
        render();
        return;
      }

      const setNormalBtn = e.target.closest('[data-hs-set-normal]');
      if (setNormalBtn) {
        const cut = setNormalBtn.dataset.hsSetNormal;
        const nextSpecs = Object.assign({}, hsState.specs);
        nextSpecs[cut] = '정상';
        hsState.editingCut = null;
        saveDoc(
          nextSpecs,
          hsState.orders,
          `${cut} 부위가 '정상'으로 변경되었습니다.`,
          '[한우 스펙] 업데이트',
          `${formatDateKo(hsState.selectedDate)} ${cut}: 정상`
        );
        return;
      }

      const saveCutBtn = e.target.closest('[data-hs-save-cut]');
      if (saveCutBtn) {
        const cut = saveCutBtn.dataset.hsSaveCut;
        const input = document.getElementById('hsCutEditInput');
        const val = input ? input.value.trim() : '';
        const finalVal = val || '정상';
        const nextSpecs = Object.assign({}, hsState.specs);
        nextSpecs[cut] = finalVal;
        hsState.editingCut = null;
        saveDoc(
          nextSpecs,
          hsState.orders,
          `${cut} 스펙이 저장되었습니다.`,
          '[한우 스펙] 업데이트',
          `${formatDateKo(hsState.selectedDate)} ${cut}: ${finalVal}`
        );
        return;
      }

      if (e.target.closest('[data-hs-reset-all]')) {
        const b = getBridge();
        const doReset = function () {
          hsState.editingCut = null;
          saveDoc(
            createDefaultSpecs(),
            hsState.orders,
            '모든 부위가 정상으로 초기화되었습니다.',
            '[한우 스펙] 전체 정상 초기화',
            `${formatDateKo(hsState.selectedDate)} 14개 부위 전체 정상 초기화`
          );
        };
        if (b && typeof b.openConfirmModal === 'function') {
          b.openConfirmModal({
            title: '전체 정상 초기화',
            message: `${formatDateKo(hsState.selectedDate)} 14개 부위 스펙을 모두 '정상'으로 초기화하시겠습니까?`,
            okText: '초기화',
            cancelText: '취소',
            onConfirm: doReset
          });
        } else {
          doReset();
        }
        return;
      }

      if (e.target.closest('[data-hs-copy-spec]')) {
        copyText(buildSpecCopyText(), '당일 가공 스펙이 복사되었습니다.');
        return;
      }

      // --- 발주 이벤트 ---
      if (e.target.closest('[data-hs-copy-order]')) {
        copyText(buildOrderCopyText(), '당일 생산분 발주가 복사되었습니다.');
        return;
      }

      if (e.target.closest('[data-hs-add-form-item]')) {
        hsState.formItems.push(createEmptyOrderItem());
        render();
        return;
      }

      const removeFormItemBtn = e.target.closest('[data-hs-remove-form-item]');
      if (removeFormItemBtn) {
        const idx = Number(removeFormItemBtn.dataset.hsRemoveFormItem);
        hsState.formItems.splice(idx, 1);
        if (hsState.formItems.length === 0) hsState.formItems.push(createEmptyOrderItem());
        render();
        return;
      }

      if (e.target.closest('[data-hs-cancel-order]')) {
        hsState.editingOrderId = null;
        hsState.formVendor = '';
        hsState.formItems = [createEmptyOrderItem()];
        render();
        return;
      }

      if (e.target.closest('[data-hs-submit-order]')) {
        const b = getBridge();
        const user = b ? b.getCurrentUser() : null;
        const vendor = (hsState.formVendor || '').trim();
        if (!vendor) {
          if (b) b.showToast('거래처명을 입력해 주세요.');
          return;
        }
        const validItems = hsState.formItems.filter(function (it) {
          return (it.partName || '').trim() !== '' || (it.qty || '').trim() !== '';
        }).map(function (it) {
          return {
            id: it.id || ('itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
            grade: it.grade || '기타',
            partName: (it.partName || '').trim(),
            qty: (it.qty || '').trim(),
            note: (it.note || '').trim(),
            done: !!it.done
          };
        });

        if (validItems.length === 0) {
          if (b) b.showToast('최소 1개 이상의 품목을 입력해 주세요.');
          return;
        }

        let nextOrders = hsState.orders.slice();
        const isEdit = !!hsState.editingOrderId;
        if (isEdit) {
          nextOrders = nextOrders.map(function (ord) {
            if (ord.id === hsState.editingOrderId) {
              return Object.assign({}, ord, { vendor: vendor, items: validItems });
            }
            return ord;
          });
        } else {
          nextOrders.push({
            id: 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            vendor: vendor,
            items: validItems,
            authorName: user ? user.name : '',
            createdAt: Date.now()
          });
        }

        hsState.editingOrderId = null;
        hsState.formVendor = '';
        hsState.formItems = [createEmptyOrderItem()];

        saveDoc(
          hsState.specs,
          nextOrders,
          isEdit ? `'${vendor}' 발주가 수정되었습니다.` : `'${vendor}' 발주가 등록되었습니다.`,
          '[한우 발주] 업데이트',
          `${formatDateKo(hsState.selectedDate)} ${vendor} (${validItems.length}건)`
        );
        return;
      }

      const editOrderBtn = e.target.closest('[data-hs-edit-order]');
      if (editOrderBtn) {
        const id = editOrderBtn.dataset.hsEditOrder;
        const found = hsState.orders.find(function (o) { return o.id === id; });
        if (!found) return;
        hsState.editingOrderId = found.id;
        hsState.formVendor = found.vendor || '';
        hsState.formItems = (found.items || []).map(function (x) { return Object.assign({}, x); });
        if (hsState.formItems.length === 0) hsState.formItems.push(createEmptyOrderItem());
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const delOrderBtn = e.target.closest('[data-hs-del-order]');
      if (delOrderBtn) {
        const id = delOrderBtn.dataset.hsDelOrder;
        const found = hsState.orders.find(function (o) { return o.id === id; });
        if (!found) return;
        const b = getBridge();
        const doDel = function () {
          const nextOrders = hsState.orders.filter(function (o) { return o.id !== id; });
          saveDoc(hsState.specs, nextOrders, `'${found.vendor}' 발주가 삭제되었습니다.`, null, null);
        };
        if (b && typeof b.openConfirmModal === 'function') {
          b.openConfirmModal({
            title: '발주 삭제',
            message: `'${found.vendor}' 거래처 발주를 삭제하시겠습니까?`,
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
      if (e.target && e.target.id === 'hsDateInput') {
        const nextDate = e.target.value;
        if (nextDate) {
          hsState.selectedDate = nextDate;
          hsState.editingCut = null;
          hsState.editingOrderId = null;
          subscribeDateDoc(nextDate);
        }
        return;
      }

      if (e.target && e.target.dataset.hsToggleItemDone) {
        const orderId = e.target.dataset.hsOrderId;
        const itemId = e.target.dataset.hsItemId;
        const checked = !!e.target.checked;
        const nextOrders = hsState.orders.map(function (ord) {
          if (ord.id !== orderId) return ord;
          return Object.assign({}, ord, {
            items: (ord.items || []).map(function (it) {
              if (it.id !== itemId) return it;
              return Object.assign({}, it, { done: checked });
            })
          });
        });
        saveDoc(hsState.specs, nextOrders, null, null, null);
        return;
      }

      if (e.target && e.target.dataset.hsFormField === 'grade') {
        const idx = Number(e.target.dataset.hsFormIdx);
        if (hsState.formItems[idx]) {
          hsState.formItems[idx].grade = e.target.value;
        }
      }
    });

    container.addEventListener('input', function (e) {
      if (!e.target) return;
      if (e.target.id === 'hsCutEditInput') {
        hsState.editingCutText = e.target.value;
        return;
      }
      if (e.target.id === 'hsFormVendorInput') {
        hsState.formVendor = e.target.value;
        return;
      }
      if (e.target.dataset.hsFormField) {
        const idx = Number(e.target.dataset.hsFormIdx);
        const field = e.target.dataset.hsFormField;
        if (hsState.formItems[idx]) {
          hsState.formItems[idx][field] = e.target.value;
        }
      }
    });
  }

  function init() {
    if (hsState.initialized) return;
    hsState.initialized = true;
    bindEvents();
    subscribeDateDoc(hsState.selectedDate);
    render();
  }

  window.MinsokHanwooSpec = {
    init: init,
    render: render
  };
})();
