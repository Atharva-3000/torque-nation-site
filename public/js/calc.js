// Shared invoice maths — imported by the server (authoritative) and by the
// admin editor (live preview). All arithmetic is done in paise (integers).

const toPaise = (n) => Math.round((Number(n) || 0) * 100);

/**
 * @param {Array<{qty:number, rate:number, discount?:number, gst?:number, kind?:string}>} items
 * @param {{gstEnabled:boolean, interState:boolean, extraDiscount?:number}} opts
 */
export function computeTotals(items, opts = {}) {
  const gstOn = !!opts.gstEnabled;
  let gross = 0, discount = 0, taxable = 0, tax = 0, labour = 0, parts = 0;
  const lines = (items || []).map((it) => {
    const qty = Number(it.qty) || 0;
    const amount = Math.round(qty * toPaise(it.rate));
    const disc = Math.round(amount * Math.min(Math.max(Number(it.discount) || 0, 0), 100) / 100);
    const base = amount - disc;
    const rate = gstOn ? Number(it.gst) || 0 : 0;
    const lineTax = Math.round(base * rate / 100);
    gross += amount; discount += disc; taxable += base; tax += lineTax;
    if (it.kind === 'part') parts += base; else labour += base;
    return { amount, discount: disc, taxable: base, tax: lineTax, total: base + lineTax };
  });

  const extra = Math.min(toPaise(opts.extraDiscount), taxable + tax);
  const preRound = taxable + tax - extra;
  const rounded = Math.round(preRound / 100) * 100;
  const roundOff = rounded - preRound;

  const half = Math.floor(tax / 2);
  return {
    lines,
    gross, discount, taxable, labour, parts,
    tax,
    cgst: gstOn && !opts.interState ? half : 0,
    sgst: gstOn && !opts.interState ? tax - half : 0,
    igst: gstOn && opts.interState ? tax : 0,
    extraDiscount: extra,
    roundOff,
    total: rounded,
  };
}

/** Group tax by rate for the invoice tax summary. */
export function taxBreakdown(items, totals) {
  const map = new Map();
  (items || []).forEach((it, i) => {
    const line = totals.lines[i];
    if (!line || !line.tax) return;
    const key = Number(it.gst) || 0;
    const row = map.get(key) || { rate: key, taxable: 0, tax: 0 };
    row.taxable += line.taxable; row.tax += line.tax;
    map.set(key, row);
  });
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

/** ₹1,23,456.00 from paise */
export function inr(paise, { symbol = true, decimals = 2 } = {}) {
  const neg = paise < 0;
  const n = Math.abs(paise) / 100;
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (neg ? '−' : '') + (symbol ? '₹' : '') + s;
}

/** ₹ from rupees, no decimals: catalog prices */
export function rupees(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}
function threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? ONES[h] + ' Hundred' : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Indian numbering system: "Rupees One Lakh Twenty Three Thousand … Only" */
export function amountInWords(paise) {
  let rupeesPart = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  if (rupeesPart === 0 && p === 0) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(rupeesPart / 10000000); rupeesPart %= 10000000;
  const lakh = Math.floor(rupeesPart / 100000); rupeesPart %= 100000;
  const thousand = Math.floor(rupeesPart / 1000); rupeesPart %= 1000;
  if (crore) parts.push((crore >= 100 ? threeDigits(crore) : twoDigits(crore)) + ' Crore');
  if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
  if (rupeesPart) parts.push(threeDigits(rupeesPart));
  let out = parts.length ? 'Rupees ' + parts.join(' ') : '';
  if (p) out += (out ? ' and ' : '') + twoDigits(p) + ' Paise';
  return out + ' Only';
}

/** Indian financial year label for a date: 2026-10-16 → "26-27" */
export function fiscalYear(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return String(start).slice(2) + '-' + String(start + 1).slice(2);
}
