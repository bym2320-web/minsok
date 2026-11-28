(function () {
  'use strict';

  const COLLECTION = 'frozenInventory';

  // 한우 기본 품목 구성
  const HANWOO_BYPRODUCT_CUT_ITEMS = [
    '사골', '잡뼈', '우족', '꼬리', '반골', '마구리'
  ];

  const HANWOO_BYPRODUCT_BOX_ITEMS = [
    '우지방', '4각머리(두)', '우설X머리', '택배머리', '골발머리', '알꼬리', '골발우설X'
  ];

  const HANWOO_MEAT_ITEMS = [
    '냉동양지', '냉동우둔', '냉동사태', '냉동목심',
    '냉동설도', '냉동앞다리', '냉동통사태', '냉동차돌박이'
  ];

  const HANWOO_GRADES = ['1++', '1+', '1', '2', '3'];

  // 한돈 기본 23개 품목
  const DEFAULT_HANDON_ITEMS = [
    '꽃삼겹(냉동/비닐포장)',
    '삼겹살(냉동/진공)',
    '미박삼겹살(냉동/진공)',
    '수육용목심(냉동/진공)',
    '앞다리(냉동/진공)',
    '미박앞다리(냉동/진공)',
    '뼈삼겹(냉동/미박/박피)',
    '목심(냉동)',
    '뒷다리(냉동)',
    '갈비(냉동/진공)',
    '갈매기살(냉동)',
    '안심(냉동/진공)',
    '등심(냉동)',
    '미박뒷사태(속사태/냉동)',
    '등심덧살(냉동)',
    '항정살(냉동)',
    '장족(냉동)',
    '등갈비(냉동)',
    '미니족(냉동/단족)',
    '돼지등뼈(냉동)',
    '냉동돈피(돼지껍질)',
    '냉동지방A',
    '돼지사골'
  ];

  function createDefaultHanwooData() {
    const cut = {};
    HANWOO_BYPRODUCT_CUT_ITEMS.forEach(function (name) {
      cut[name] = { uncut: '', cut: '' };
    });
    const box = {};
    HANWOO_BYPRODUCT_BOX_ITEMS.forEach(function (name) {
      box[name] = '';
    });
    const meat = {};
    HANWOO_MEAT_ITEMS.forEach(function (name) {
      meat[name] = { '1++': '', '1+': '', '1': '', '2': '', '3': '' };
    });
    return {
      cut: cut,
      box: box,
      meat: meat,
      updatedAt: null,
      updatedBy: null
    };
  }

  function createDefaultHandonData() {
    return {
      items: DEFAULT_HANDON_ITEMS.map(function (name, idx) {
        return { id: 'hd_' + (idx + 1), name: name, qty: '' };
      }),
      updatedAt: null,
      updatedBy: null
    };
  }

  const invState = {
    subTab: 'hanwoo', // 'hanwoo' | 'handon'
    hanwoo: createDefaultHanwooData(),
    handon: createDefaultHandonData(),
    hanwooDirty: false,
    handonDirty: false,
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

  function canEditFrozenInventory() {
    const b = getBridge();
    if (!b || typeof b.getCurrentUser !== 'function') return false;
    const user = b.getCurrentUser();
    if (!user) return false;
    const part = typeof b.normalizePartName === 'function' ? b.normalizePartName(user.part) : (user.part || '');
    return user.isAdmin === true || part === '냉동';
  }

  function formatUpdatedText(ts, by) {
    if (!ts) return '아직 저장된 기록이 없습니다.';
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `최종 수정: ${y}-${m}-${day} ${hh}:${mm}${by ? ` (${by})` : ''}`;
  }

  function mergeHanwooData(remote) {
    const base = createDefaultHanwooData();
    if (!remote) return base;

    if (remote.cut) {
      HANWOO_BYPRODUCT_CUT_ITEMS.forEach(function (name) {
        if (remote.cut[name]) {
          base.cut[name] = {
            uncut: remote.cut[name].uncut != null ? String(remote.cut[name].uncut) : '',
            cut: remote.cut[name].cut != null ? String(remote.cut[name].cut) : ''
          };
        }
      });
    }
    if (remote.box) {
      HANWOO_BYPRODUCT_BOX_ITEMS.forEach(function (name) {
        if (remote.box[name] != null) {
          base.box[name] = String(remote.box[name]);
        }
      });
    }
    if (remote.meat) {
      HANWOO_MEAT_ITEMS.forEach(function (name) {
        if (remote.meat[name]) {
          HANWOO_GRADES.forEach(function (g) {
            if (remote.meat[name][g] != null) {
              base.meat[name][g] = String(remote.meat[name][g]);
            }
          });
        }
      });
    }
    base.updatedAt = remote.updatedAt || null;
    base.updatedBy = remote.updatedBy || null;
    return base;
  }

  function mergeHandonData(remote) {
    if (!remote || !Array.isArray(remote.items) || remote.items.length === 0) {
      return createDefaultHandonData();
    }
    return {
      items: remote.items.map(function (it, idx) {
        return {
          id: it.id || ('hd_' + Date.now() + '_' + idx),
          name: String(it.name || ''),
          qty: it.qty != null ? String(it.qty) : ''
        };
      }),
      updatedAt: remote.updatedAt || null,
      updatedBy: remote.updatedBy || null
    };
  }

  function initFirestoreSync() {
    const b = getBridge();
    if (!b) return;
    const db = b.getDb();
    if (!db) return;

    // 한우 실시간 동기화
    db.collection(COLLECTION).doc('hanwoo').onSnapshot(function (doc) {
      if (invState.hanwooDirty) return;
      invState.hanwoo = doc.exists ? mergeHanwooData(doc.data()) : createDefaultHanwooData();
      render();
    }, function (err) {
      console.error('frozenInventory/hanwoo onSnapshot 오류:', err);
    });

    // 한돈 실시간 동기화
    db.collection(COLLECTION).doc('handon').onSnapshot(function (doc) {
      if (invState.handonDirty) return;
      invState.handon = doc.exists ? mergeHandonData(doc.data()) : createDefaultHandonData();
      render();
    }, function (err) {
      console.error('frozenInventory/handon onSnapshot 오류:', err);
    });
  }

  function saveHanwoo() {
    const b = getBridge();
    if (!b || !canEditFrozenInventory()) {
      if (b) b.showToast('관리자 또는 냉동 파트 인원만 수정할 수 있습니다.');
      return;
    }
    const db = b.getDb();
    const user = b.getCurrentUser();
    if (!db || !user) return;

    const payload = {
      cut: invState.hanwoo.cut,
      box: invState.hanwoo.box,
      meat: invState.hanwoo.meat,
      updatedAt: Date.now(),
      updatedBy: user.name
    };

    db.collection(COLLECTION).doc('hanwoo').set(payload)
      .then(function () {
        invState.hanwooDirty = false;
        invState.hanwoo.updatedAt = payload.updatedAt;
        invState.hanwoo.updatedBy = payload.updatedBy;
        render();
        b.showToast('한우 냉동재고가 저장되었습니다.');
      })
      .catch(function (err) {
        console.error('한우 재고 저장 오류:', err);
        b.showToast('저장 중 오류가 발생했습니다.');
      });
  }

  function saveHandon() {
    const b = getBridge();
    if (!b || !canEditFrozenInventory()) {
      if (b) b.showToast('관리자 또는 냉동 파트 인원만 수정할 수 있습니다.');
      return;
    }
    const db = b.getDb();
    const user = b.getCurrentUser();
    if (!db || !user) return;

    const payload = {
      items: invState.handon.items,
      updatedAt: Date.now(),
      updatedBy: user.name
    };

    db.collection(COLLECTION).doc('handon').set(payload)
      .then(function () {
        invState.handonDirty = false;
        invState.handon.updatedAt = payload.updatedAt;
        invState.handon.updatedBy = payload.updatedBy;
        render();
        b.showToast('한돈 냉동재고가 저장되었습니다.');
      })
      .catch(function (err) {
        console.error('한돈 재고 저장 오류:', err);
        b.showToast('저장 중 오류가 발생했습니다.');
      });
  }

  function renderHanwooHtml(editable) {
    const data = invState.hanwoo;
    const inputBaseCls = editable
      ? 'w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:border-[#B30E2A] focus:ring-2 focus:ring-[#B30E2A]/15 outline-none text-center text-xs sm:text-sm font-bold text-slate-900'
      : 'w-full px-2 py-1.5 rounded-lg bg-slate-50 text-center text-xs sm:text-sm font-bold text-slate-800';

    // 표 1: 냉동부산물 (절단/비절단)
    const cutRows = HANWOO_BYPRODUCT_CUT_ITEMS.map(function (name) {
      const row = data.cut[name] || { uncut: '', cut: '' };
      return `
        <tr class="border-t border-slate-100">
          <td class="px-3 py-2 text-xs sm:text-sm font-extrabold text-slate-800 bg-slate-50/70 whitespace-nowrap">${esc(name)}</td>
          <td class="px-2 py-1.5">
            ${editable
              ? `<input type="text" data-hw-group="cut" data-hw-item="${esc(name)}" data-hw-field="uncut" value="${esc(row.uncut)}" placeholder="-" class="${inputBaseCls}" />`
              : `<div class="${inputBaseCls}">${esc(row.uncut || '-')}</div>`}
          </td>
          <td class="px-2 py-1.5">
            ${editable
              ? `<input type="text" data-hw-group="cut" data-hw-item="${esc(name)}" data-hw-field="cut" value="${esc(row.cut)}" placeholder="-" class="${inputBaseCls}" />`
              : `<div class="${inputBaseCls}">${esc(row.cut || '-')}</div>`}
          </td>
        </tr>
      `;
    }).join('');

    // 표 2: 냉동부산물 (박스)
    const boxRows = HANWOO_BYPRODUCT_BOX_ITEMS.map(function (name) {
      const val = data.box[name] || '';
      return `
        <tr class="border-t border-slate-100">
          <td class="px-3 py-2 text-xs sm:text-sm font-extrabold text-slate-800 bg-slate-50/70 whitespace-nowrap">${esc(name)}</td>
          <td class="px-2 py-1.5">
            ${editable
              ? `<input type="text" data-hw-group="box" data-hw-item="${esc(name)}" value="${esc(val)}" placeholder="-" class="${inputBaseCls}" />`
              : `<div class="${inputBaseCls}">${esc(val || '-')}</div>`}
          </td>
        </tr>
      `;
    }).join('');

    // 표 3: 냉동정육 (등급별)
    const meatRows = HANWOO_MEAT_ITEMS.map(function (name) {
      const row = data.meat[name] || {};
      const gradeCells = HANWOO_GRADES.map(function (g) {
        const val = row[g] || '';
        return `
          <td class="px-1.5 py-1.5 min-w-[58px]">
            ${editable
              ? `<input type="text" data-hw-group="meat" data-hw-item="${esc(name)}" data-hw-field="${esc(g)}" value="${esc(val)}" placeholder="-" class="${inputBaseCls}" />`
              : `<div class="${inputBaseCls}">${esc(val || '-')}</div>`}
          </td>
        `;
      }).join('');

      return `
        <tr class="border-t border-slate-100">
          <td class="px-2.5 py-2 text-xs sm:text-sm font-extrabold text-slate-800 bg-slate-50/70 whitespace-nowrap sticky left-0 z-10 border-r border-slate-100">${esc(name)}</td>
          ${gradeCells}
        </tr>
      `;
    }).join('');

    return `
      <!-- 상단 상태/저장 바 -->
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <div class="min-w-0">
          <p class="text-xs font-bold text-slate-500">${esc(formatUpdatedText(data.updatedAt, data.updatedBy))}</p>
          ${invState.hanwooDirty ? '<p class="text-[11px] font-extrabold text-[#B30E2A] mt-0.5">● 변경된 내용이 있습니다. 저장 버튼을 눌러주세요.</p>' : ''}
        </div>
        ${editable ? `
          <button
            type="button"
            data-inv-save="hanwoo"
            class="px-4 py-2 rounded-xl bg-[#B30E2A] hover:bg-[#960B22] active:scale-[0.98] text-white text-xs font-extrabold shadow-sm cursor-pointer transition whitespace-nowrap"
          >
            한우 재고 저장
          </button>
        ` : ''}
      </div>

      <!-- 표 1 & 표 2 (PC 2단 / 모바일 1단) -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div class="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between">
            <h3 class="text-xs sm:text-sm font-extrabold">냉동부산물 (절단/비절단)</h3>
            <span class="text-[11px] font-semibold text-slate-300">단위: 두</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse">
              <thead>
                <tr class="bg-slate-100 text-slate-700 text-xs font-extrabold">
                  <th class="px-3 py-2 text-left w-[36%]">품명</th>
                  <th class="px-2 py-2 text-center w-[32%]">비절단(두)</th>
                  <th class="px-2 py-2 text-center w-[32%]">절단(두)</th>
                </tr>
              </thead>
              <tbody>${cutRows}</tbody>
            </table>
          </div>
        </section>

        <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div class="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between">
            <h3 class="text-xs sm:text-sm font-extrabold">냉동부산물 (박스)</h3>
            <span class="text-[11px] font-semibold text-slate-300">숫자 / X 자유 입력</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse">
              <thead>
                <tr class="bg-slate-100 text-slate-700 text-xs font-extrabold">
                  <th class="px-3 py-2 text-left w-[52%]">품명</th>
                  <th class="px-2 py-2 text-center w-[48%]">박스(두)</th>
                </tr>
              </thead>
              <tbody>${boxRows}</tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- 표 3: 냉동정육 (등급별) -->
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div class="px-4 py-2.5 bg-[#B30E2A] text-white flex items-center justify-between">
          <h3 class="text-xs sm:text-sm font-extrabold">냉동정육 (등급별)</h3>
          <span class="text-[11px] font-semibold text-white/85">좌우 스크롤 가능</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr class="bg-slate-100 text-slate-700 text-xs font-extrabold">
                <th class="px-2.5 py-2 text-left whitespace-nowrap sticky left-0 z-10 bg-slate-100 border-r border-slate-200">품명</th>
                ${HANWOO_GRADES.map(function (g) {
                  return `<th class="px-2 py-2 text-center whitespace-nowrap">(${esc(g)})</th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>${meatRows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderHandonHtml(editable) {
    const data = invState.handon;
    const items = data.items || [];

    const cardsHtml = items.map(function (it) {
      return `
        <div class="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50/80 border border-slate-200/80">
          <span class="text-xs sm:text-sm font-extrabold text-slate-800 break-keep leading-snug flex-1 min-w-0">${esc(it.name)}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            ${editable
              ? `<input type="text" data-hd-qty="${esc(it.id)}" value="${esc(it.qty)}" placeholder="수량" class="w-20 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:border-[#B30E2A] focus:ring-2 focus:ring-[#B30E2A]/15 outline-none text-center text-xs sm:text-sm font-extrabold text-slate-900" />`
              : `<span class="inline-flex items-center justify-center min-w-[56px] px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs sm:text-sm font-extrabold ${it.qty ? 'text-[#B30E2A]' : 'text-slate-400'}">${esc(it.qty || '-')}</span>`}
            ${editable
              ? `<button type="button" data-hd-delete="${esc(it.id)}" class="w-7 h-7 rounded-lg bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-400 hover:text-red-600 text-xs font-bold cursor-pointer transition" title="품목 삭제">✕</button>`
              : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <!-- 상단 상태/저장 바 -->
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <div class="min-w-0">
          <p class="text-xs font-bold text-slate-500">${esc(formatUpdatedText(data.updatedAt, data.updatedBy))}</p>
          ${invState.handonDirty ? '<p class="text-[11px] font-extrabold text-[#B30E2A] mt-0.5">● 변경된 내용이 있습니다. 저장 버튼을 눌러주세요.</p>' : ''}
        </div>
        ${editable ? `
          <button
            type="button"
            data-inv-save="handon"
            class="px-4 py-2 rounded-xl bg-[#B30E2A] hover:bg-[#960B22] active:scale-[0.98] text-white text-xs font-extrabold shadow-sm cursor-pointer transition whitespace-nowrap"
          >
            한돈 재고 저장
          </button>
        ` : ''}
      </div>

      <!-- 한돈 품목 리스트 -->
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3.5 sm:p-4 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-extrabold text-slate-900">한돈 냉동 품목 (${items.length}개)</h3>
          <span class="text-[11px] font-semibold text-slate-400">실시간 동기화</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${cardsHtml || '<p class="col-span-full py-8 text-center text-xs font-bold text-slate-400">등록된 품목이 없습니다.</p>'}
        </div>

        ${editable ? `
          <div class="pt-3 border-t border-slate-100 flex items-center gap-2">
            <input
              id="handonNewItemInput"
              type="text"
              placeholder="새 한돈 품목명 입력..."
              class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-[#B30E2A] outline-none text-xs font-bold"
            />
            <button
              type="button"
              data-hd-add="1"
              class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-extrabold cursor-pointer transition whitespace-nowrap shrink-0"
            >
              + 품목 추가
            </button>
          </div>
        ` : ''}
      </section>
    `;
  }

  function render() {
    const container = document.getElementById('frozenTabPanel');
    if (!container) return;

    const editable = canEditFrozenInventory();
    const isHanwoo = invState.subTab === 'hanwoo';

    const headerHtml = `
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3.5 flex items-center justify-between gap-2 flex-wrap">
        <div class="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
          <button
            type="button"
            data-inv-subtab="hanwoo"
            class="px-4 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${isHanwoo ? 'bg-[#B30E2A] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
          >
            🐄 한우
          </button>
          <button
            type="button"
            data-inv-subtab="handon"
            class="px-4 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${!isHanwoo ? 'bg-[#B30E2A] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}"
          >
            🐷 한돈
          </button>
        </div>

        <span class="px-2.5 py-1 rounded-lg text-[11px] font-extrabold border ${editable ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-slate-50 text-slate-500 border-slate-200'}">
          ${editable ? '✏️ 수정 가능 (관리자 · 냉동)' : '👀 열람 전용'}
        </span>
      </div>
    `;

    container.innerHTML = headerHtml + (isHanwoo ? renderHanwooHtml(editable) : renderHandonHtml(editable));
  }

  function bindContainerEvents() {
    const container = document.getElementById('frozenTabPanel');
    if (!container || invState.listenersBound) return;
    invState.listenersBound = true;

    container.addEventListener('click', function (e) {
      const subBtn = e.target.closest('[data-inv-subtab]');
      if (subBtn) {
        invState.subTab = subBtn.dataset.invSubtab;
        render();
        return;
      }

      const saveBtn = e.target.closest('[data-inv-save]');
      if (saveBtn) {
        if (saveBtn.dataset.invSave === 'hanwoo') {
          saveHanwoo();
        } else {
          saveHandon();
        }
        return;
      }

      const addBtn = e.target.closest('[data-hd-add]');
      if (addBtn) {
        if (!canEditFrozenInventory()) return;
        const input = document.getElementById('handonNewItemInput');
        const name = input ? input.value.trim() : '';
        const b = getBridge();
        if (!name) {
          if (b) b.showToast('추가할 품목명을 입력해 주세요.');
          return;
        }
        invState.handon.items.push({
          id: 'hd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          name: name,
          qty: ''
        });
        invState.handonDirty = true;
        render();
        if (b) b.showToast(`'${name}' 품목이 추가되었습니다. 저장 버튼을 눌러 반영하세요.`);
        return;
      }

      const delBtn = e.target.closest('[data-hd-delete]');
      if (delBtn) {
        if (!canEditFrozenInventory()) return;
        const id = delBtn.dataset.hdDelete;
        const target = invState.handon.items.find(function (x) { return x.id === id; });
        if (!target) return;
        const b = getBridge();
        const doDelete = function () {
          invState.handon.items = invState.handon.items.filter(function (x) { return x.id !== id; });
          invState.handonDirty = true;
          render();
          if (b) b.showToast('품목이 삭제되었습니다. 저장 버튼을 눌러 반영하세요.');
        };
        if (b && typeof b.openConfirmModal === 'function') {
          b.openConfirmModal({
            title: '품목 삭제',
            message: `'${target.name}' 품목을 목록에서 삭제하시겠습니까?`,
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
      const target = e.target;
      if (!target) return;

      // 한우 입력 변경
      if (target.dataset.hwGroup) {
        const group = target.dataset.hwGroup;
        const item = target.dataset.hwItem;
        const field = target.dataset.hwField;
        const val = target.value;

        if (group === 'cut') {
          if (!invState.hanwoo.cut[item]) invState.hanwoo.cut[item] = { uncut: '', cut: '' };
          invState.hanwoo.cut[item][field] = val;
        } else if (group === 'box') {
          invState.hanwoo.box[item] = val;
        } else if (group === 'meat') {
          if (!invState.hanwoo.meat[item]) invState.hanwoo.meat[item] = {};
          invState.hanwoo.meat[item][field] = val;
        }
        if (!invState.hanwooDirty) {
          invState.hanwooDirty = true;
        }
        return;
      }

      // 한돈 수량 변경
      if (target.dataset.hdQty) {
        const id = target.dataset.hdQty;
        const found = invState.handon.items.find(function (x) { return x.id === id; });
        if (found) {
          found.qty = target.value;
          if (!invState.handonDirty) {
            invState.handonDirty = true;
          }
        }
      }
    });

    container.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'handonNewItemInput' && e.key === 'Enter') {
        e.preventDefault();
        const addBtn = container.querySelector('[data-hd-add]');
        if (addBtn) addBtn.click();
      }
    });
  }

  function init() {
    if (invState.initialized) return;
    invState.initialized = true;
    bindContainerEvents();
    initFirestoreSync();
    render();
  }

  window.MinsokInventory = {
    init: init,
    render: render
  };
})();
