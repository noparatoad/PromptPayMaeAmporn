/* ===== ตั้งค่า ===== */
const CONFIG = {
  PROMPTPAY_PHONE: '0831595839',
  ACCOUNT_NAME: 'น.ส.เกวรินทร์ เอกสินิทธ์กุล',
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz_pUyCg9srLlIPRmjyKfkFQ-FCWTC4C8PCuM2L9jzc0umL2wmBDC94nlo0EruXpjZi/exec'
};

/* ===== PromptPay ===== */
function tlv(id, v) { return id + String(v.length).padStart(2, '0') + v; }

function crc16(s) {
  let c = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1);
      c &= 0xFFFF;
    }
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

function buildPayload(phone, amount) {
  const target = '0066' + phone.replace(/^0/, '');
  const merchant = tlv('00', 'A000000677010111') + tlv('01', target);
  const p = tlv('00', '01') + tlv('01', '12') + tlv('29', merchant)
          + tlv('53', '764') + tlv('54', amount.toFixed(2))
          + tlv('58', 'TH') + '6304';
  return p + crc16(p);
}

/* ===== ตัวช่วย ===== */
const $ = id => document.getElementById(id);
const screens = ['screenLock', 'screenInput', 'screenQR', 'screenDone', 'screenSummary'];
let current = { amount: 0, id: '' };
let busy = false;

const fmt = n => Number(n).toLocaleString('th-TH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

function show(name) {
  screens.forEach(s => $(s).classList.toggle('hidden', s !== name));
  const logged = name !== 'screenLock';
  $('tabs').classList.toggle('hidden', !logged);
  $('tabPay').classList.toggle('active', name !== 'screenSummary');
  $('tabSum').classList.toggle('active', name === 'screenSummary');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/* ===== เรียก Google Apps Script ===== */
async function api(payload) {
  if (!CONFIG.SCRIPT_URL.startsWith('https://')) {
    throw new Error('ยังไม่ได้ตั้งค่า SCRIPT_URL ใน app.js');
  }
  payload.pin = sessionStorage.getItem('pin') || '';
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok && data.pinError) logout(true);
  return data;
}

/* ===== PIN ===== */
async function login() {
  const pin = $('pinInput').value.trim();
  if (pin.length < 4) return toast('กรุณาใส่ PIN อย่างน้อย 4 หลัก');
  if (busy) return;
  busy = true;
  $('btnLogin').disabled = true;
  $('btnLogin').textContent = 'กำลังตรวจสอบ...';
  try {
    sessionStorage.setItem('pin', pin);
    const data = await api({ action: 'login' });
    if (!data.ok) {
      sessionStorage.removeItem('pin');
      $('pinInput').value = '';
      return toast(data.error || 'PIN ไม่ถูกต้อง');
    }
    $('pinInput').value = '';
    show('screenInput');
    $('amount').focus();
  } catch (err) {
    sessionStorage.removeItem('pin');
    toast(err.message || 'เชื่อมต่อไม่ได้ กรุณาลองใหม่');
  } finally {
    busy = false;
    $('btnLogin').disabled = false;
    $('btnLogin').textContent = 'เข้าสู่ระบบ';
  }
}

function logout(expired) {
  sessionStorage.removeItem('pin');
  show('screenLock');
  if (expired) toast('กรุณาใส่ PIN ใหม่อีกครั้ง');
}

/* ===== ช่องกรอกยอด ===== */
$('amount').addEventListener('input', e => {
  let v = e.target.value.replace(/[^0-9.]/g, '');
  const p = v.split('.');
  if (p.length > 2) v = p[0] + '.' + p.slice(1).join('');
  const q = v.split('.');
  if (q[1] && q[1].length > 2) v = q[0] + '.' + q[1].slice(0, 2);
  e.target.value = v;
});
$('amount').addEventListener('keydown', e => { if (e.key === 'Enter') createQR(); });
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

/* ===== สร้าง QR ===== */
function createQR() {
  const amount = parseFloat($('amount').value);
  if (!amount || amount <= 0) return toast('กรุณากรอกยอดเงินให้ถูกต้อง');
  if (amount > 1000000) return toast('ยอดเงินสูงเกินกำหนด');

  current = { amount: amount, id: 'T' + Date.now() };

  const qr = qrcode(0, 'M');
  qr.addData(buildPayload(CONFIG.PROMPTPAY_PHONE, amount));
  qr.make();

  $('qrBox').innerHTML = '<img alt="QR PromptPay" src="' + qr.createDataURL(8, 0) + '">';
  $('showAmount').textContent = fmt(amount);
  $('accName').textContent = CONFIG.ACCOUNT_NAME;
  show('screenQR');
}

/* ===== บันทึกยอดขาย ===== */
async function savePaid() {
  if (busy) return;
  busy = true;
  const btn = $('btnPaid');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';
  try {
    const data = await api({
      action: 'save',
      id: current.id,
      amount: current.amount,
      status: 'โอนแล้ว'
    });
    if (!data.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
    $('doneAmount').textContent = fmt(current.amount) + ' บาท';
    show('screenDone');
  } catch (err) {
    toast(err.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ===== สรุปยอดขาย ===== */
async function loadSummary() {
  const date = $('sumDate').value || todayStr();
  $('sumList').innerHTML = '<div class="empty">กำลังโหลด...</div>';
  try {
    const data = await api({ action: 'summary', date: date });
    if (!data.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');

    $('sumTotal').textContent = fmt(data.total);
    $('sumCount').textContent = data.count + ' รายการ';

    const max = Math.max.apply(null, data.week.map(w => w.total).concat([1]));
    $('sumWeek').innerHTML = data.week.map(w => {
      const label = w.date.slice(8, 10) + '/' + w.date.slice(5, 7);
      const pct = Math.round(w.total / max * 100);
      return '<div class="week-row' + (w.date === date ? ' sel' : '') + '">'
        + '<span class="d">' + label + '</span>'
        + '<span class="bar"><i style="width:' + pct + '%"></i></span>'
        + '<span class="v">' + fmt(w.total) + '</span></div>';
    }).join('');

    $('sumList').innerHTML = data.list.length
      ? data.list.map(r =>
          '<div class="list-item"><span>' + r.time + '</span><span>'
          + fmt(r.amount) + ' บาท</span></div>').join('')
      : '<div class="empty">ยังไม่มีรายการในวันนี้</div>';
  } catch (err) {
    $('sumList').innerHTML = '';
    toast(err.message || 'โหลดข้อมูลไม่สำเร็จ');
  }
}

function openSummary() {
  if (!$('sumDate').value) $('sumDate').value = todayStr();
  show('screenSummary');
  loadSummary();
}

/* ===== ปุ่มต่าง ๆ ===== */
$('btnLogin').addEventListener('click', login);
$('btnCreate').addEventListener('click', createQR);
$('btnPaid').addEventListener('click', savePaid);
$('btnLock').addEventListener('click', () => logout(false));
$('tabPay').addEventListener('click', () => { show('screenInput'); $('amount').focus(); });
$('tabSum').addEventListener('click', openSummary);
$('btnRefresh').addEventListener('click', loadSummary);
$('sumDate').addEventListener('change', loadSummary);

$('btnBack').addEventListener('click', () => { show('screenInput'); $('amount').focus(); });
$('btnNew').addEventListener('click', () => {
  $('amount').value = '';
  show('screenInput');
  $('amount').focus();
});

/* ===== เริ่มต้น ===== */
if (sessionStorage.getItem('pin')) {
  show('screenInput');
  $('amount').focus();
} else {
  show('screenLock');
  $('pinInput').focus();
}