import {
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { bookingsApi, decorsApi, uploadApi, DecorDoc } from '../../lib/api';
import ImageViewer from '../../lib/ImageViewer';

let ImagePicker: any = null;
try { ImagePicker = require('expo-image-picker'); } catch {}

const SHEET_MAX_H = Dimensions.get('window').height * 0.88;

// ── Types ──────────────────────────────────────────────────────────────────────
const VENUE_OPTIONS = ['A1 Function Hall', 'A1 Grand'];
const VENUES = ['All Venues', ...VENUE_OPTIONS];

type Slot = 'morning' | 'evening';
type BookingStatus = 'confirmed' | 'pending' | 'cancelled' | 'paid';

interface Expense {
  id: string;
  title: string;
  amount: number;
}

interface ExtraBenefit {
  id: string;
  name: string;
  amount: number;
}

const PAYMENT_MODES = ['Cash', 'PhonePay', 'Bank Transfer', 'Cheque', 'Other'] as const;
type PaymentMode = typeof PAYMENT_MODES[number];
const MODE_ICON: Record<PaymentMode, string> = {
  Cash: '💵', PhonePay: '📱', 'Bank Transfer': '🏦', Cheque: '📄', Other: '💳',
};

interface Payment {
  id: string;
  amount: number;
  mode: PaymentMode;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  note?: string;
}

interface Booking {
  id: string;
  venue: string;
  date: string; // YYYY-MM-DD
  slot: Slot;
  eventName: string;
  guestCount: number;
  amount: number;       // base venue cost
  payments: Payment[];
  status: BookingStatus;
  client: string;
  phone: string;
  startReading?: number;
  endReading?: number;
  acHours?: number;
  decorCost?: number;
  extraBenefits: ExtraBenefit[];
  expenses: Expense[];
  discount?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function daysInMonth(year: number, month: number)  { return new Date(year, month + 1, 0).getDate(); }
function firstDayOfMonth(year: number, month: number) { return new Date(year, month, 1).getDay(); }
function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function fmtMoney(n: number) { return '₹' + n.toLocaleString('en-IN'); }
function isValidDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime()); }
function fmtDateStr(d: string) {
  if (!isValidDate(d)) return d || '—';
  const dt = new Date(d + 'T00:00:00');
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dt.getDate()} ${M[dt.getMonth()]} ${dt.getFullYear()}`;
}

function elecCharge(b: Booking) {
  if (b.startReading != null && b.endReading != null && b.endReading >= b.startReading)
    return (b.endReading - b.startReading) * 20;
  return 0;
}
function acCharge(b: Booking)        { return (b.acHours ?? 0) * 3500; }
function acInternalCost(b: Booking)  { return (b.acHours ?? 0) * 1500; }
function extraBenefitsTotal(b: Booking) { return b.extraBenefits.reduce((s, e) => s + e.amount, 0); }
function totalCost(b: Booking)      { return b.amount + elecCharge(b) + acCharge(b) + (b.decorCost ?? 0) + extraBenefitsTotal(b); }
function totalExpenses(b: Booking)  { return b.expenses.reduce((s, e) => s + e.amount, 0); }
function totalAdvancePaid(b: Booking) { return b.payments.reduce((s, p) => s + p.amount, 0); }
function effectiveBalance(b: Booking) { return Math.max(0, totalCost(b) - totalAdvancePaid(b) - (b.discount ?? 0)); }
function netEarned(b: Booking)      { return totalCost(b) - totalExpenses(b) - acInternalCost(b) - (b.discount ?? 0); }
function nowDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

function normalizeBooking(d: any): Booking {
  return {
    id:            d._id,
    venue:         d.venue        ?? '',
    date:          d.date         ?? '',
    slot:          d.slot         ?? 'morning',
    eventName:     d.eventName    ?? '',
    guestCount:    d.guestCount   ?? 0,
    amount:        d.amount       ?? 0,
    status:        d.status       ?? 'pending',
    client:        d.client       ?? '',
    phone:         d.phone        ?? '',
    startReading:  d.startReading ?? undefined,
    endReading:    d.endReading   ?? undefined,
    acHours:       d.acHours      ?? undefined,
    decorCost:     d.decorCost    ?? undefined,
    discount:      d.discount     ?? undefined,
    payments: (d.payments ?? []).map((p: any) => ({
      id: p._id, amount: p.amount, mode: p.mode, date: p.date, time: p.time ?? '', note: p.note,
    })),
    expenses: (d.expenses ?? []).map((e: any) => ({
      id: e._id, title: e.title, amount: e.amount,
    })),
    extraBenefits: (d.extraBenefits ?? []).map((b: any) => ({
      id: b._id, name: b.name, amount: b.amount,
    })),
  };
}

function toBookingPayload(b: Booking) {
  const { id: _id, ...rest } = b;
  return {
    ...rest,
    startReading:  b.startReading  ?? null,
    endReading:    b.endReading    ?? null,
    acHours:       b.acHours       ?? null,
    decorCost:     b.decorCost     ?? null,
    discount:      b.discount      ?? null,
    payments:      b.payments.map(({ id: _i, ...p }) => p),
    expenses:      b.expenses.map(({ id: _i, ...e }) => e),
    extraBenefits: b.extraBenefits.map(({ id: _i, ...eb }) => eb),
  };
}

// ── Cross-platform Date Picker ─────────────────────────────────────────────────
let RNDateTimePicker: any = null;
if (Platform.OS !== 'web') {
  RNDateTimePicker = require('@react-native-community/datetimepicker').default;
}

function DatePickerField({
  value, onChange, style,
}: {
  value: string; onChange: (d: string) => void; style?: any;
}) {
  const [show, setShow] = useState(false);
  const dateObj = isValidDate(value) ? new Date(value + 'T12:00:00') : new Date();

  const baseStyle = {
    backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1,
    borderColor: 'rgba(123,97,255,0.15)', overflow: 'hidden' as const,
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[baseStyle, style]}>
        <input
          type="date"
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          style={{
            border: 'none', background: 'transparent', fontSize: 14,
            color: value ? '#1A1A2E' : '#9B98C0', width: '100%',
            padding: '10px 12px', fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
          } as any}
        />
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[baseStyle, { paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'center' }, style]}
        onPress={() => setShow(true)}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 14, color: value ? '#1A1A2E' : '#9B98C0' }}>
          {value || 'Select date'}
        </Text>
      </TouchableOpacity>
      {show && RNDateTimePicker && (
        <RNDateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={(_: any, date?: Date) => {
            setShow(false);
            if (date) {
              onChange(
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
              );
            }
          }}
        />
      )}
    </>
  );
}

// ── Calendar ───────────────────────────────────────────────────────────────────
function Calendar({
  year, month, bookings, selectedDate, onSelectDate, onPrev, onNext,
}: {
  year: number; month: number; bookings: Booking[];
  selectedDate: string | null; onSelectDate: (d: string | null) => void;
  onPrev: () => void; onNext: () => void;
}) {
  const totalDays = daysInMonth(year, month);
  const startDay  = firstDayOfMonth(year, month);

  const dotMap: Record<string, { morning: boolean; evening: boolean }> = {};
  bookings.forEach(b => {
    if (!dotMap[b.date]) dotMap[b.date] = { morning: false, evening: false };
    dotMap[b.date][b.slot] = true;
  });

  const cells: (number | null)[] = [
    ...Array(startDay).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = toDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  return (
    <View style={cal.container}>
      <View style={cal.header}>
        <TouchableOpacity onPress={onPrev} style={cal.navBtn}><Text style={cal.navText}>{'<'}</Text></TouchableOpacity>
        <Text style={cal.monthTitle}>{MONTH_NAMES[month]} {year}</Text>
        <TouchableOpacity onPress={onNext} style={cal.navBtn}><Text style={cal.navText}>{'>'}</Text></TouchableOpacity>
      </View>

      <View style={cal.row}>
        {DAY_NAMES.map(d => <Text key={d} style={cal.dayName}>{d}</Text>)}
      </View>

      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={cal.row}>
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <View key={col} style={cal.cell} />;
            const dateStr   = toDateStr(year, month, day);
            const dots      = dotMap[dateStr];
            const isSelected = dateStr === selectedDate;
            const isToday   = dateStr === todayStr;
            return (
              <TouchableOpacity
                key={col}
                style={[cal.cell, isSelected && cal.selectedCell, isToday && !isSelected && cal.todayCell]}
                onPress={() => onSelectDate(isSelected ? null : dateStr)}
                activeOpacity={0.7}
              >
                <Text style={[cal.dayNum, isSelected && cal.selectedDayNum, isToday && !isSelected && cal.todayDayNum]}>
                  {day}
                </Text>
                {dots ? (
                  <View style={cal.dots}>
                    {dots.morning ? <View style={[cal.dot, cal.morningDot]} /> : null}
                    {dots.evening ? <View style={[cal.dot, cal.eveningDot]} /> : null}
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <View style={cal.legend}>
        <View style={cal.legendItem}><View style={[cal.dot, cal.morningDot]} /><Text style={cal.legendText}> Morning</Text></View>
        <View style={cal.legendItem}><View style={[cal.dot, cal.eveningDot]} /><Text style={cal.legendText}> Evening</Text></View>
      </View>
    </View>
  );
}

// ── Booking Card ───────────────────────────────────────────────────────────────
function BookingCard({ booking, onPress }: { booking: Booking; onPress: () => void }) {
  const ec      = elecCharge(booking);
  const tc      = totalCost(booking);
  const balance = effectiveBalance(booking);
  const paidPct = tc > 0 ? Math.min(100, Math.round(((tc - balance) / tc) * 100)) : 0;

  const statusColor: Record<BookingStatus, string> = {
    confirmed: '#27ae60', pending: '#f39c12', cancelled: '#e74c3c', paid: '#1abc9c',
  };
  const slotColor = booking.slot === 'morning' ? '#2980b9' : '#8e44ad';

  const cardBadgeLabel =
    booking.status === 'paid' ? '✓ Payment Completed' :
    booking.status === 'cancelled' ? 'Cancelled' :
    balance > 0 ? 'Payment Pending' :
    booking.status.charAt(0).toUpperCase() + booking.status.slice(1);
  const cardBadgeColor =
    booking.status === 'paid' ? '#1abc9c' :
    booking.status === 'cancelled' ? '#e74c3c' :
    balance > 0 ? '#e67e22' :
    statusColor[booking.status];

  return (
    <TouchableOpacity style={card.container} onPress={onPress} activeOpacity={0.85}>
      <View style={card.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={card.venue}>{booking.venue}</Text>
          <Text style={card.eventName}>{booking.eventName}  ·  {booking.guestCount} guests</Text>
          <Text style={card.client}>{booking.client}  {booking.phone}</Text>
        </View>
        <View style={[card.badge, { backgroundColor: cardBadgeColor + '22' }]}>
          <Text style={[card.badgeText, { color: cardBadgeColor }]}>{cardBadgeLabel}</Text>
        </View>
      </View>

      <View style={card.metaRow}>
        <Text style={card.meta}>📅 {booking.date}</Text>
        <View style={[card.slotBadge, { backgroundColor: slotColor + '22' }]}>
          <Text style={[card.slotText, { color: slotColor }]}>
            {booking.slot === 'morning' ? '🌅 Morning' : '🌆 Evening'}
          </Text>
        </View>
      </View>

      {ec > 0 ? (
        <Text style={card.elecTag}>⚡ Electricity: {fmtMoney(ec)} added</Text>
      ) : null}
      {(booking.acHours ?? 0) > 0 ? (
        <Text style={card.acTag}>❄️ AC: {booking.acHours} hr{booking.acHours !== 1 ? 's' : ''}  ·  {fmtMoney(acCharge(booking))} added</Text>
      ) : null}
      {(booking.decorCost ?? 0) > 0 ? (
        <Text style={card.decorTag}>🎨 Decor: {fmtMoney(booking.decorCost!)} added</Text>
      ) : null}
      {booking.extraBenefits.length > 0 ? (
        <Text style={card.benefitTag}>🎁 {booking.extraBenefits.length} extra benefit{booking.extraBenefits.length > 1 ? 's' : ''}: {fmtMoney(extraBenefitsTotal(booking))} added</Text>
      ) : null}

      <View style={card.finance}>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Total</Text>
          <Text style={card.finValue}>{fmtMoney(tc)}</Text>
        </View>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Advance</Text>
          <Text style={[card.finValue, { color: '#27ae60' }]}>{fmtMoney(totalAdvancePaid(booking))}</Text>
        </View>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Balance</Text>
          <Text style={[card.finValue, { color: balance > 0 ? '#e74c3c' : '#27ae60' }]}>{fmtMoney(balance)}</Text>
        </View>
      </View>

      <View style={card.barBg}>
        <View style={[card.barFill, { width: (booking.status === 'paid' ? '100%' : paidPct + '%') as any, backgroundColor: booking.status === 'paid' ? '#1abc9c' : '#27ae60' }]} />
      </View>
      <Text style={card.barLabel}>{booking.status === 'paid' ? '✓ Fully Paid' : paidPct + '% paid'}</Text>
    </TouchableOpacity>
  );
}

// ── Customer PDF ───────────────────────────────────────────────────────────────
function buildCustomerHTML(b: Booking): string {
  const ec  = elecCharge(b);
  const ac  = acCharge(b);
  const dc  = b.decorCost ?? 0;
  const tc       = totalCost(b);
  const disc     = b.discount ?? 0;
  const netPayable = tc - disc;
  const adv      = totalAdvancePaid(b);
  const bal      = netPayable - adv;
  const slot = b.slot === 'morning' ? 'Morning' : 'Evening';

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${dt.getDate()}-${M[dt.getMonth()]}-${dt.getFullYear()}`;
  };

  const invoiceNum = `INV-${new Date().getFullYear()}-${b.id.toString().padStart(4,'0')}`;
  const today      = fmtDate(nowDate());

  // Reusable table cell styles
  const TD  = 'padding:9px 14px;font-size:13px;color:#333;border-bottom:1px solid #ebebeb;';
  const TDR = TD + 'text-align:right;';
  const TH  = 'padding:8px 14px;font-size:11px;font-weight:700;color:#555;background:#f5f5f5;text-align:left;border-bottom:1px solid #ddd;';
  const THR = TH + 'text-align:right;';

  const sectionHeading = (t: string) =>
    `<p style="font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin:20px 0 6px;">${t}</p>`;

  const infoRow = (label: string, value: string) =>
    `<tr><td style="${TD}color:#888;">${label}</td><td style="${TDR}font-weight:600;color:#111;">${value}</td></tr>`;

  const chargeRow = (desc: string, amt: number) =>
    `<tr><td style="${TD}">${desc}</td><td style="${TDR}">${fmtMoney(amt)}</td></tr>`;

  const paymentRows = b.payments.map(p =>
    `<tr>
      <td style="${TD}">${p.mode}</td>
      <td style="${TD}">${fmtDate(p.date)} &nbsp; ${p.time}</td>
      <td style="${TDR}font-weight:600;">${fmtMoney(p.amount)}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body { margin:0; padding:24px; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#222; background:#fff; }
  table { width:100%; border-collapse:collapse; }
  td, th { vertical-align:top; }
</style>
</head>
<body>

<!-- ── HEADER ── -->
<table style="margin-bottom:16px;">
  <tr>
    <td>
      <p style="margin:0;font-size:24px;font-weight:700;color:#111;">A1 Groups</p>
      <p style="margin:4px 0 0;font-size:12px;color:#888;">A1 Function Hall &amp; A1 Grand</p>
    </td>
    <td style="text-align:right;">
      <p style="margin:0;font-size:20px;font-weight:700;color:#111;">INVOICE</p>
      <p style="margin:4px 0 0;font-size:12px;color:#888;">${invoiceNum}</p>
      <p style="margin:2px 0 0;font-size:12px;color:#888;">Date: ${today}</p>
    </td>
  </tr>
</table>
<hr style="border:none;border-top:2px solid #222;margin:0 0 16px;"/>

<!-- ── CUSTOMER + EVENT ── -->
<table style="margin-bottom:4px;">
  <tr>
    <td style="width:50%;padding-right:12px;vertical-align:top;">
      ${sectionHeading('Customer Details')}
      <table style="border:1px solid #ddd;">
        ${infoRow('Name', b.client)}
        ${infoRow('Mobile', b.phone)}
        ${infoRow('Event', b.eventName)}
      </table>
    </td>
    <td style="width:50%;padding-left:12px;vertical-align:top;">
      ${sectionHeading('Event Details')}
      <table style="border:1px solid #ddd;">
        ${infoRow('Venue', b.venue)}
        ${infoRow('Date', fmtDate(b.date))}
        ${infoRow('Slot', slot + ' Session')}
        ${infoRow('Guests', b.guestCount + ' persons')}
      </table>
    </td>
  </tr>
</table>

<!-- ── CHARGES ── -->
${sectionHeading('Charges')}
<table style="border:1px solid #ddd;">
  <tr>
    <th style="${TH}">Description</th>
    <th style="${THR}">Amount</th>
  </tr>
  ${chargeRow('Venue Booking — ' + slot + ' Session, ' + b.guestCount + ' guests', b.amount)}
  ${ec > 0 ? chargeRow('Electricity — ' + b.startReading + ' to ' + b.endReading + ' (' + (b.endReading! - b.startReading!) + ' units × ₹20)', ec) : ''}
  ${ac > 0 ? chargeRow('AC Usage — ' + b.acHours + ' hr' + (b.acHours !== 1 ? 's' : '') + ' × ₹3,500', ac) : ''}
  ${dc > 0 ? chargeRow('Decor', dc) : ''}
  ${b.extraBenefits.map(e => chargeRow(e.name, e.amount)).join('')}
  ${(b.discount ?? 0) > 0 ? `
  <tr>
    <td style="${TD}color:#27ae60;font-weight:700;">🎁 Discount</td>
    <td style="${TDR}color:#27ae60;font-weight:700;">− ${fmtMoney(b.discount!)}</td>
  </tr>` : ''}
  <tr>
    <td style="padding:10px 14px;font-size:14px;font-weight:700;color:#111;background:#f5f5f5;border-top:2px solid #ddd;">${(b.discount ?? 0) > 0 ? 'Net Payable' : 'Total'}</td>
    <td style="padding:10px 14px;font-size:14px;font-weight:700;color:#111;text-align:right;background:#f5f5f5;border-top:2px solid #ddd;">${fmtMoney(tc - (b.discount ?? 0))}</td>
  </tr>
</table>

<!-- ── PAYMENTS ── -->
${b.payments.length > 0 ? `
${sectionHeading('Payments Received')}
<table style="border:1px solid #ddd;">
  <tr>
    <th style="${TH}">Mode</th>
    <th style="${TH}">Date &amp; Time</th>
    <th style="${THR}">Amount</th>
  </tr>
  ${paymentRows}
  <tr>
    <td colspan="2" style="padding:10px 14px;font-size:13px;font-weight:700;color:#111;background:#f5f5f5;border-top:2px solid #ddd;">Total Advance Paid</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#111;text-align:right;background:#f5f5f5;border-top:2px solid #ddd;">${fmtMoney(adv)}</td>
  </tr>
</table>` : ''}

<!-- ── SUMMARY ── -->
${sectionHeading('Summary')}
<table style="border:1px solid #ddd;">
  ${infoRow('Total Amount', fmtMoney(tc))}
  ${disc > 0 ? infoRow('🎁 Discount', '− ' + fmtMoney(disc)) : ''}
  ${disc > 0 ? infoRow('Net Payable', fmtMoney(netPayable)) : ''}
  ${infoRow('Advance Paid', fmtMoney(adv))}
  <tr style="background:${bal > 0 ? '#fff2f2' : '#f2fff5'};">
    <td style="padding:12px 14px;font-size:15px;font-weight:700;color:${bal > 0 ? '#c0392b' : '#1e8449'};">
      ${bal > 0 ? 'Balance Due' : 'Fully Paid'}
    </td>
    <td style="padding:12px 14px;font-size:15px;font-weight:700;color:${bal > 0 ? '#c0392b' : '#1e8449'};text-align:right;">
      ${fmtMoney(Math.abs(bal))}
    </td>
  </tr>
</table>

<!-- ── FOOTER ── -->
<table style="margin-top:28px;border-top:1px solid #ccc;padding-top:10px;">
  <tr>
    <td style="font-size:11px;color:#999;">A1 Groups &nbsp;·&nbsp; A1 Function Hall &amp; A1 Grand</td>
    <td style="font-size:11px;color:#bbb;text-align:right;">Computer generated &nbsp;·&nbsp; ${invoiceNum}</td>
  </tr>
</table>

</body>
</html>`;
}

async function printBooking(b: Booking) {
  const html = buildCustomerHTML(b);
  try {
    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
    } else {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Booking PDF' });
      } else {
        await Print.printAsync({ html });
      }
    }
  } catch (e: any) {
    Alert.alert('Error', e?.message ?? 'Could not generate PDF.');
  }
}

// ── Decor Detail Sheet (view + edit linked decor from inside a booking) ─────────

const DECOR_EVENT_TYPES = [
  'Reception','Engagement','Wedding','Birthday','Half Saree',
  'Dhoti Ceremony','Haldi','Sangeeth','Baby Shower',
  'Anniversary','Corporate Event','Others',
];

function buildDecorPDF(d: DecorDoc): string {
  const total = d.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
  const bal   = Math.max(0, total - d.advanceAmount - d.settledAmount);
  const TD  = 'padding:8px 12px;font-size:12px;color:#333;border-bottom:1px solid #ebebeb;';
  const TDR = TD + 'text-align:right;';
  const TH  = 'padding:7px 12px;font-size:11px;font-weight:700;color:#555;background:#f5f5f5;text-align:left;';
  const THR = TH + 'text-align:right;';
  const itemRows = d.decorItems.map(i =>
    `<tr><td style="${TD}">${i.name}</td><td style="${TDR}">${i.quantity}</td><td style="${TDR}">${fmtMoney(i.costPerUnit)}</td><td style="${TDR}font-weight:600;">${fmtMoney(i.quantity * i.costPerUnit)}</td></tr>`
  ).join('');
  const reqRows = d.requiredItems.map(r =>
    `<tr><td style="${TD}">${r.name}</td><td style="${TDR}">${r.quantity}</td><td style="${TD}">${r.description || '&mdash;'}</td></tr>`
  ).join('');
  const today = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>body{margin:0;padding:24px;font-family:Arial,sans-serif;font-size:13px;color:#222;background:#fff;}table{width:100%;border-collapse:collapse;}</style>
</head><body>
<table style="margin-bottom:16px;"><tr>
  <td><p style="margin:0;font-size:22px;font-weight:700;color:#111;">A1 Groups</p><p style="margin:4px 0 0;font-size:11px;color:#888;">Decor Management</p></td>
  <td style="text-align:right;"><p style="margin:0;font-size:18px;font-weight:700;">DECOR ESTIMATE</p><p style="margin:4px 0 0;font-size:11px;color:#888;">Date: ${fmtDateStr(d.createdDate)}</p></td>
</tr></table>
<hr style="border:none;border-top:2px solid #222;margin:0 0 14px;"/>
<table style="margin-bottom:14px;"><tr>
  <td style="width:50%;vertical-align:top;padding-right:12px;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:0 0 6px;">Customer</p>
    <table style="border:1px solid #ddd;">
      <tr><td style="${TD}color:#888;">Name</td><td style="${TDR}font-weight:600;">${d.customerName}</td></tr>
      <tr><td style="${TD}color:#888;">Mobile</td><td style="${TDR}">${d.mobile}</td></tr>
      <tr><td style="${TD}color:#888;">Event</td><td style="${TDR}">${d.eventName}</td></tr>
    </table>
  </td>
  <td style="width:50%;vertical-align:top;padding-left:12px;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:0 0 6px;">Event Details</p>
    <table style="border:1px solid #ddd;">
      <tr><td style="${TD}color:#888;">Type</td><td style="${TDR}font-weight:600;">${d.eventType || '—'}</td></tr>
      <tr><td style="${TD}color:#888;">Date</td><td style="${TDR}">${fmtDateStr(d.eventDate)}</td></tr>
      <tr><td style="${TD}color:#888;">Location</td><td style="${TDR}">${d.location || '&mdash;'}</td></tr>
    </table>
  </td>
</tr></table>
<p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:14px 0 6px;">Decor Items</p>
<table style="border:1px solid #ddd;">
  <tr><th style="${TH}">Item</th><th style="${THR}">Qty</th><th style="${THR}">Rate</th><th style="${THR}">Amount</th></tr>
  ${itemRows || `<tr><td colspan="4" style="padding:10px 12px;color:#aaa;font-style:italic;">No items added</td></tr>`}
  <tr><td colspan="3" style="padding:9px 12px;font-size:13px;font-weight:700;background:#f5f5f5;border-top:2px solid #ddd;">Total Decor Cost</td>
      <td style="padding:9px 12px;font-size:13px;font-weight:700;text-align:right;background:#f5f5f5;border-top:2px solid #ddd;">${fmtMoney(total)}</td></tr>
</table>
<p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:14px 0 6px;">Payment</p>
<table style="border:1px solid #ddd;">
  <tr><td style="${TD}color:#888;">Advance Paid</td><td style="${TDR}">${fmtMoney(d.advanceAmount)}</td></tr>
  <tr><td style="${TD}color:#888;">Amount Settled</td><td style="${TDR}">${fmtMoney(d.settledAmount)}</td></tr>
  <tr style="background:${bal > 0 ? '#fff2f2' : '#f2fff5'};"><td style="padding:10px 12px;font-size:14px;font-weight:700;color:${bal > 0 ? '#c0392b' : '#1e8449'};">${bal > 0 ? 'Balance Due' : 'Fully Paid'}</td>
  <td style="padding:10px 12px;font-size:14px;font-weight:700;text-align:right;color:${bal > 0 ? '#c0392b' : '#1e8449'};">${fmtMoney(bal)}</td></tr>
</table>
${reqRows ? `<p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:14px 0 6px;">Items Required</p><table style="border:1px solid #ddd;"><tr><th style="${TH}">Item</th><th style="${THR}">Qty</th><th style="${TH}">Description</th></tr>${reqRows}</table>` : ''}
${d.comments ? `<p style="margin:14px 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;color:#555;">Notes</p><p style="border:1px solid #ddd;padding:10px;border-radius:4px;font-size:12px;color:#444;">${d.comments}</p>` : ''}
<table style="margin-top:24px;border-top:1px solid #ccc;padding-top:8px;"><tr>
  <td style="font-size:10px;color:#999;">A1 Groups &middot; Decor Management</td>
  <td style="font-size:10px;color:#bbb;text-align:right;">Generated ${fmtDateStr(today)}</td>
</tr></table>
</body></html>`;
}

async function printDecorDoc(d: DecorDoc) {
  const html = buildDecorPDF(d);
  try {
    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
    } else {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Decor Estimate' });
      else await Print.printAsync({ html });
    }
  } catch (err: any) { Alert.alert('Error', err?.message ?? 'Could not generate PDF.'); }
}

function DecorDetailSheet({ decor: init, initialMode = 'view', onClose, onSaved }: {
  decor: DecorDoc;
  initialMode?: 'view' | 'edit';
  onClose: () => void;
  onSaved: (updated: DecorDoc) => void;
}) {
  const [mode, setMode]     = useState<'view' | 'edit'>(initialMode);
  const [saving, setSaving] = useState(false);
  const [doc, setDoc]       = useState<DecorDoc>(init);

  // Edit form fields
  const [eventName,    setEventName]    = useState(init.eventName);
  const [customerName, setCustomerName] = useState(init.customerName);
  const [mobile,       setMobile]       = useState(init.mobile);
  const [eventType,    setEventType]    = useState(init.eventType);
  const [eventDate,    setEventDate]    = useState(init.eventDate);
  const [location,     setLocation]     = useState(init.location);
  const [decorItems,   setDecorItems]   = useState(init.decorItems.map(i => ({ ...i })));
  const [reqItems,     setReqItems]     = useState(init.requiredItems.map(r => ({ ...r })));
  const [advance,      setAdvance]      = useState(String(init.advanceAmount));
  const [settled,      setSettled]      = useState(String(init.settledAmount));
  const [payStatus,    setPayStatus]    = useState<'pending' | 'partial' | 'completed'>(init.paymentStatus);
  const [comments,     setComments]     = useState(init.comments);
  const [images,       setImages]       = useState<string[]>(init.images ?? []);
  const [uploading,    setUploading]    = useState(false);
  const [activeImg,    setActiveImg]    = useState(0);
  const [fullImgIdx,   setFullImgIdx]   = useState<number | null>(null);

  const [newItemName, setNewItemName] = useState('');
  const [newItemQty,  setNewItemQty]  = useState('1');
  const [newItemCost, setNewItemCost] = useState('');
  const [newReqName,  setNewReqName]  = useState('');
  const [newReqQty,   setNewReqQty]   = useState('1');
  const [newReqDesc,  setNewReqDesc]  = useState('');

  const { width: SW } = Dimensions.get('window');
  const decorTotal = decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
  const paid       = Number(advance || 0) + Number(settled || 0);
  const balance    = Math.max(0, decorTotal - paid);

  async function pickImages() {
    if (!ImagePicker) return Alert.alert('Not available', 'Image picker is not available on this platform.');
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Permission needed', 'Allow photo library access to add images.');
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.7,
      });
      if (!result.canceled && result.assets?.length) {
        setUploading(true);
        try {
          const urls = await Promise.all(result.assets.map((a: any) => uploadApi.uploadImage(a.uri)));
          setImages(prev => [...prev, ...urls]);
        } catch (e: any) { Alert.alert('Upload failed', e.message); }
        finally { setUploading(false); }
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
  }

  function removeImage(idx: number) { setImages(prev => prev.filter((_, i) => i !== idx)); }

  function addDecorItem() {
    if (!newItemName.trim()) return;
    setDecorItems(p => [...p, { name: newItemName.trim(), quantity: Number(newItemQty) || 1, costPerUnit: Number(newItemCost) || 0 }]);
    setNewItemName(''); setNewItemQty('1'); setNewItemCost('');
  }
  function removeDecorItem(idx: number) { setDecorItems(p => p.filter((_, i) => i !== idx)); }

  function addReqItem() {
    if (!newReqName.trim()) return;
    setReqItems(p => [...p, { name: newReqName.trim(), quantity: Number(newReqQty) || 1, description: newReqDesc.trim() }]);
    setNewReqName(''); setNewReqQty('1'); setNewReqDesc('');
  }
  function removeReqItem(idx: number) { setReqItems(p => p.filter((_, i) => i !== idx)); }

  async function handleSave() {
    if (!eventName.trim())    return Alert.alert('Required', 'Event name is required.');
    if (!customerName.trim()) return Alert.alert('Required', 'Customer name is required.');
    if (!mobile.trim())       return Alert.alert('Required', 'Mobile number is required.');
    setSaving(true);
    try {
      const updated = await decorsApi.update(init._id, {
        eventName: eventName.trim(), customerName: customerName.trim(), mobile: mobile.trim(),
        eventType, eventDate, location: location.trim(),
        images, decorItems, requiredItems: reqItems,
        advanceAmount: Number(advance) || 0, settledAmount: Number(settled) || 0,
        paymentStatus: payStatus, comments: comments.trim(),
      });
      setDoc(updated);
      onSaved(updated);
      setMode('view');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not save changes.');
    } finally { setSaving(false); }
  }

  const dTotal = doc.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
  const dBal   = Math.max(0, dTotal - doc.advanceAmount - doc.settledAmount);
  const sc     = doc.paymentStatus === 'completed' ? '#27ae60' : doc.paymentStatus === 'partial' ? '#f39c12' : '#e74c3c';

  return (
    <>
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000055' }}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%', position: 'absolute', bottom: 0 }}>
          <View style={{ backgroundColor: '#EEF0FF', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: SHEET_MAX_H }}>

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eaecf4' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#1A1A2E' }} numberOfLines={1}>
                  {mode === 'edit' ? '✏️ Edit Decor' : '🎨 Decor Details'}
                </Text>
                <Text style={{ fontSize: 11, color: '#9B98C0', marginTop: 1 }} numberOfLines={1}>{doc.eventName}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                {mode === 'view' && (
                  <>
                    <TouchableOpacity onPress={() => printDecorDoc(doc)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#27ae6015', borderWidth: 1, borderColor: '#27ae6040' }}>
                      <Text style={{ color: '#27ae60', fontSize: 12, fontWeight: '700' }}>🖨 Print</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setMode('edit')} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#8e44ad15', borderWidth: 1, borderColor: '#8e44ad40' }}>
                      <Text style={{ color: '#8e44ad', fontSize: 12, fontWeight: '700' }}>✏️ Edit</Text>
                    </TouchableOpacity>
                  </>
                )}
                {mode === 'edit' && (
                  <>
                    <TouchableOpacity onPress={() => setMode('view')} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f0f0f8' }}>
                      <Text style={{ color: '#666', fontSize: 12, fontWeight: '700' }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleSave} disabled={saving} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: saving ? '#ccc' : '#27ae60' }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{saving ? 'Saving…' : '✓ Save'}</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
                  <Text style={{ color: '#9B98C0', fontSize: 18, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

              {mode === 'view' ? (
                <>
                  {/* Image Gallery — view mode */}
                  {doc.images.length > 0 && (
                    <View style={{ marginBottom: 16 }}>
                      <ScrollView
                        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                        style={{ borderRadius: 14, overflow: 'hidden' }}
                        onMomentumScrollEnd={e => setActiveImg(Math.round(e.nativeEvent.contentOffset.x / (SW - 32)))}
                      >
                        {doc.images.map((uri, i) => (
                          <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => setFullImgIdx(i)}>
                            <Image source={{ uri }} style={{ width: SW - 32, height: 240, borderRadius: 14, backgroundColor: '#1A1A2E' }} resizeMode="contain" />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                      {doc.images.length > 1 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 6 }}>
                          {doc.images.map((_, i) => (
                            <View key={i} style={{ width: i === activeImg ? 10 : 7, height: i === activeImg ? 10 : 7, borderRadius: 5, backgroundColor: i === activeImg ? '#7B61FF' : 'rgba(123,97,255,0.2)' }} />
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  {doc.images.length === 0 && (
                    <View style={{ backgroundColor: '#f8f8fc', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', padding: 20, alignItems: 'center', marginBottom: 14 }}>
                      <Text style={{ fontSize: 24, marginBottom: 4 }}>🖼</Text>
                      <Text style={{ fontSize: 12, color: '#9B98C0' }}>No images added to this decor</Text>
                    </View>
                  )}

                  {/* Info table */}
                  <View style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', marginBottom: 14, overflow: 'hidden' }}>
                    {[
                      ['Event Name', doc.eventName],
                      ['Customer',   doc.customerName],
                      ['Mobile',     doc.mobile],
                      ['Event Type', doc.eventType || '—'],
                      ['Event Date', fmtDateStr(doc.eventDate)],
                      ['Location',   doc.location || '—'],
                      ['Created',    fmtDateStr(doc.createdDate)],
                    ].map(([label, value], idx) => (
                      <View key={label} style={{ flexDirection: 'row', padding: 10, borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: '#f4f4f4' }}>
                        <Text style={{ flex: 1, fontSize: 12, color: '#9B98C0', fontWeight: '600' }}>{label}</Text>
                        <Text style={{ flex: 2, fontSize: 13, color: '#1A1A2E', fontWeight: '500' }}>{value}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Decor items */}
                  {doc.decorItems.length > 0 && (
                    <>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 }}>Decor Items</Text>
                      <View style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', marginBottom: 14 }}>
                        <View style={{ flexDirection: 'row', backgroundColor: '#f5f5fb', padding: 8 }}>
                          {['ITEM','QTY','RATE','TOTAL'].map((h, i) => (
                            <Text key={h} style={{ flex: i === 0 ? 3 : i === 1 ? 1 : 2, fontSize: 11, fontWeight: '700', color: '#555', textAlign: i > 0 ? 'right' : 'left' }}>{h}</Text>
                          ))}
                        </View>
                        {doc.decorItems.map((item, i) => (
                          <View key={item._id ?? i} style={{ flexDirection: 'row', padding: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' }}>
                            <Text style={{ flex: 3, fontSize: 12, color: '#333' }} numberOfLines={1}>{item.name}</Text>
                            <Text style={{ flex: 1, fontSize: 12, color: '#555', textAlign: 'right' }}>{item.quantity}</Text>
                            <Text style={{ flex: 2, fontSize: 12, color: '#555', textAlign: 'right' }}>{fmtMoney(item.costPerUnit)}</Text>
                            <Text style={{ flex: 2, fontSize: 12, fontWeight: '600', color: '#333', textAlign: 'right' }}>{fmtMoney(item.quantity * item.costPerUnit)}</Text>
                          </View>
                        ))}
                        <View style={{ flexDirection: 'row', padding: 10, borderTopWidth: 2, borderTopColor: '#e0e0f0', backgroundColor: '#f9f9ff' }}>
                          <Text style={{ flex: 6, fontSize: 13, fontWeight: '700', color: '#1A1A2E' }}>Total</Text>
                          <Text style={{ flex: 2, fontSize: 13, fontWeight: '800', color: '#8e44ad', textAlign: 'right' }}>{fmtMoney(dTotal)}</Text>
                        </View>
                      </View>
                    </>
                  )}

                  {/* Required items */}
                  {doc.requiredItems.length > 0 && (
                    <>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 }}>Items Required</Text>
                      <View style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', marginBottom: 14 }}>
                        {doc.requiredItems.map((item, i) => (
                          <View key={item._id ?? i} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#f0f0f0' }}>
                            <Text style={{ flex: 2, fontSize: 12, color: '#333' }}>{item.name}</Text>
                            <Text style={{ width: 36, fontSize: 12, color: '#9B98C0', textAlign: 'center' }}>×{item.quantity}</Text>
                            <Text style={{ flex: 3, fontSize: 12, color: '#777' }}>{item.description || '—'}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  {/* Payment tiles */}
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 }}>Payment</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                    {([
                      ['Total',   fmtMoney(dTotal),              '#8e44ad'],
                      ['Advance', fmtMoney(doc.advanceAmount),   '#27ae60'],
                      ['Settled', fmtMoney(doc.settledAmount),   '#27ae60'],
                      ['Balance', fmtMoney(dBal),                dBal > 0 ? '#e74c3c' : '#27ae60'],
                    ] as [string, string, string][]).map(([lbl, val, col]) => (
                      <View key={lbl} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' }}>
                        <Text style={{ fontSize: 9, color: '#9B98C0', marginBottom: 2 }}>{lbl}</Text>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: col }}>{val}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Payment status */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', marginBottom: 14 }}>
                    <Text style={{ flex: 1, fontSize: 13, color: '#555' }}>Payment Status</Text>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: sc + '20' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: sc, textTransform: 'capitalize' }}>{doc.paymentStatus}</Text>
                    </View>
                  </View>

                  {!!doc.comments && (
                    <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', marginBottom: 14 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#9B98C0', marginBottom: 4 }}>NOTES</Text>
                      <Text style={{ fontSize: 13, color: '#444', fontStyle: 'italic' }}>"{doc.comments}"</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  {/* ── EDIT MODE ── */}
                  {/* Image section — edit mode */}
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8 }}>
                    Photos {images.length > 0 ? `(${images.length})` : ''}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {images.map((uri, i) => (
                      <View key={i} style={{ marginRight: 8, position: 'relative' }}>
                        <TouchableOpacity activeOpacity={0.85} onPress={() => setFullImgIdx(i)}>
                          <Image source={{ uri }} style={{ width: 90, height: 90, borderRadius: 12, backgroundColor: '#1A1A2E' }} resizeMode="contain" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => removeImage(i)}
                          style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={pickImages} disabled={uploading}
                      style={{ width: 90, height: 90, borderRadius: 12, borderWidth: 2, borderColor: '#7B61FF', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(123,97,255,0.04)' }}
                    >
                      <Text style={{ fontSize: 26, color: '#7B61FF', fontWeight: '300' }}>{uploading ? '…' : '+'}</Text>
                      <Text style={{ fontSize: 10, color: '#7B61FF', fontWeight: '700', marginTop: 2 }}>{uploading ? 'Uploading…' : 'Add Photos'}</Text>
                    </TouchableOpacity>
                  </ScrollView>

                  <View style={{ height: 1, backgroundColor: '#e8eaf0', marginBottom: 14 }} />
                  <Text style={det.inputLabel}>Event Name *</Text>
                  <TextInput style={[det.input, { marginBottom: 10 }]} value={eventName} onChangeText={setEventName} placeholder="Event name" />

                  <Text style={det.inputLabel}>Customer Name *</Text>
                  <TextInput style={[det.input, { marginBottom: 10 }]} value={customerName} onChangeText={setCustomerName} placeholder="Customer name" />

                  <Text style={det.inputLabel}>Mobile *</Text>
                  <TextInput style={[det.input, { marginBottom: 12 }]} value={mobile} onChangeText={setMobile} placeholder="Mobile number" keyboardType="phone-pad" />

                  <Text style={det.inputLabel}>Event Type</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {DECOR_EVENT_TYPES.map(t => (
                      <TouchableOpacity key={t} onPress={() => setEventType(t)}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: eventType === t ? '#8e44ad' : '#f0f0f8', borderWidth: 1, borderColor: eventType === t ? '#8e44ad' : '#e0e0f0' }}>
                        <Text style={{ fontSize: 12, color: eventType === t ? '#fff' : '#555', fontWeight: eventType === t ? '700' : '400' }}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={det.inputLabel}>Event Date</Text>
                      <TextInput style={det.input} value={eventDate} onChangeText={setEventDate} placeholder="YYYY-MM-DD" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={det.inputLabel}>Location</Text>
                      <TextInput style={det.input} value={location} onChangeText={setLocation} placeholder="Venue / location" />
                    </View>
                  </View>

                  <View style={{ height: 1, backgroundColor: '#e8eaf0', marginBottom: 14 }} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8 }}>Decor Items</Text>

                  {decorItems.map((item, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#1A1A2E' }}>{item.name}</Text>
                        <Text style={{ fontSize: 11, color: '#9B98C0' }}>{item.quantity} × {fmtMoney(item.costPerUnit)} = {fmtMoney(item.quantity * item.costPerUnit)}</Text>
                      </View>
                      <TouchableOpacity onPress={() => removeDecorItem(idx)} style={{ padding: 6, borderRadius: 6, backgroundColor: '#e74c3c12' }}>
                        <Text style={{ color: '#e74c3c', fontSize: 13 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                  <View style={{ backgroundColor: '#f9f9ff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e0e0f0', marginBottom: 10 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#9B98C0', marginBottom: 6 }}>ADD ITEM</Text>
                    <TextInput style={[det.input, { marginBottom: 6 }]} value={newItemName} onChangeText={setNewItemName} placeholder="Item name" />
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      <TextInput style={[det.input, { flex: 1 }]} value={newItemQty} onChangeText={setNewItemQty} placeholder="Qty" keyboardType="number-pad" />
                      <TextInput style={[det.input, { flex: 2 }]} value={newItemCost} onChangeText={setNewItemCost} placeholder="Cost / unit (₹)" keyboardType="number-pad" />
                    </View>
                    <TouchableOpacity style={{ backgroundColor: '#8e44ad', borderRadius: 8, padding: 9, alignItems: 'center' }} onPress={addDecorItem}>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>+ Add Item</Text>
                    </TouchableOpacity>
                  </View>

                  {decorItems.length > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#8e44ad' }}>Subtotal: {fmtMoney(decorTotal)}</Text>
                    </View>
                  )}

                  <View style={{ height: 1, backgroundColor: '#e8eaf0', marginBottom: 14 }} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8 }}>Items Required</Text>

                  {reqItems.map((item, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#1A1A2E' }}>{item.name} ×{item.quantity}</Text>
                        {!!item.description && <Text style={{ fontSize: 11, color: '#9B98C0' }}>{item.description}</Text>}
                      </View>
                      <TouchableOpacity onPress={() => removeReqItem(idx)} style={{ padding: 6, borderRadius: 6, backgroundColor: '#e74c3c12' }}>
                        <Text style={{ color: '#e74c3c', fontSize: 13 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                  <View style={{ backgroundColor: '#f9f9ff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e0e0f0', marginBottom: 14 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#9B98C0', marginBottom: 6 }}>ADD REQUIRED ITEM</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                      <TextInput style={[det.input, { flex: 2 }]} value={newReqName} onChangeText={setNewReqName} placeholder="Item name" />
                      <TextInput style={[det.input, { flex: 1 }]} value={newReqQty} onChangeText={setNewReqQty} placeholder="Qty" keyboardType="number-pad" />
                    </View>
                    <TextInput style={[det.input, { marginBottom: 8 }]} value={newReqDesc} onChangeText={setNewReqDesc} placeholder="Description (optional)" />
                    <TouchableOpacity style={{ backgroundColor: '#2980b9', borderRadius: 8, padding: 9, alignItems: 'center' }} onPress={addReqItem}>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>+ Add Required Item</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ height: 1, backgroundColor: '#e8eaf0', marginBottom: 14 }} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8 }}>Payment Details</Text>

                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={det.inputLabel}>Advance (₹)</Text>
                      <TextInput style={det.input} value={advance} onChangeText={setAdvance} placeholder="0" keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={det.inputLabel}>Settled (₹)</Text>
                      <TextInput style={det.input} value={settled} onChangeText={setSettled} placeholder="0" keyboardType="number-pad" />
                    </View>
                  </View>

                  <Text style={det.inputLabel}>Payment Status</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    {(['pending', 'partial', 'completed'] as const).map(s => (
                      <TouchableOpacity key={s} onPress={() => setPayStatus(s)}
                        style={{ flex: 1, padding: 8, borderRadius: 8, alignItems: 'center', backgroundColor: payStatus === s ? (s === 'completed' ? '#27ae60' : s === 'partial' ? '#f39c12' : '#e74c3c') : '#f0f0f8', borderWidth: 1, borderColor: payStatus === s ? 'transparent' : '#e0e0f0' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'capitalize', color: payStatus === s ? '#fff' : '#555' }}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {decorTotal > 0 && (
                    <View style={{ backgroundColor: '#f9f0ff', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#d7b8f3' }}>
                      {[
                        ['Total Cost', fmtMoney(decorTotal), '#8e44ad'],
                        ['Total Paid', fmtMoney(paid),       '#27ae60'],
                        ['Balance',   fmtMoney(balance),     balance > 0 ? '#e74c3c' : '#27ae60'],
                      ].map(([lbl, val, col]) => (
                        <View key={lbl} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                          <Text style={{ fontSize: 12, color: '#9B98C0' }}>{lbl}</Text>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: col }}>{val}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <Text style={det.inputLabel}>Comments / Notes</Text>
                  <TextInput style={[det.input, { height: 80, textAlignVertical: 'top', marginBottom: 16 }]}
                    value={comments} onChangeText={setComments} placeholder="Any notes about this decor…" multiline />

                  <TouchableOpacity style={[det.saveBtn, { backgroundColor: saving ? '#9B98C0' : '#27ae60', marginBottom: 10 }]} onPress={handleSave} disabled={saving}>
                    <Text style={det.saveTxt}>{saving ? 'Saving…' : '✓ Save Changes'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={det.closeBtn} onPress={() => setMode('view')}>
                    <Text style={det.closeTxt}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={{ height: 28 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    {fullImgIdx !== null && (
      <ImageViewer
        images={mode === 'view' ? doc.images : images}
        initialIndex={fullImgIdx}
        onClose={() => setFullImgIdx(null)}
      />
    )}
    </>
  );
}

// ── Booking Detail / Edit Modal ────────────────────────────────────────────────
function BookingDetailModal({
  booking: init, onClose, onUpdate,
}: {
  booking: Booking; onClose: () => void; onUpdate: (b: Booking) => Promise<void>;
}) {
  const [booking, setBooking] = useState<Booking>(init);
  const [isEditing, setIsEditing] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    client:     init.client,
    phone:      init.phone,
    eventName:  init.eventName,
    venue:      init.venue,
    date:       init.date,
    slot:       init.slot as Slot,
    guestCount: init.guestCount.toString(),
    amount:     init.amount.toString(),
    status:     init.status as BookingStatus,
  });

  // Electricity, decor & expense state
  const [startR, setStartR]       = useState(init.startReading?.toString() ?? '');
  const [endR, setEndR]           = useState(init.endReading?.toString() ?? '');
  const [acInput, setAcInput]       = useState(init.acHours?.toString() ?? '');
  const [decorInput, setDecorInput] = useState(init.decorCost?.toString() ?? '');
  const [expTitle, setExpTitle]   = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [benefitName, setBenefitName]     = useState('');
  const [benefitAmount, setBenefitAmount] = useState('');
  const [payMode, setPayMode]             = useState<PaymentMode>('Cash');
  const [payAmount, setPayAmount]         = useState('');
  const [payDate, setPayDate]             = useState(nowDate());
  const [payTime, setPayTime]             = useState(nowTime());
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [balAmount, setBalAmount]         = useState('');
  const [balMode, setBalMode]             = useState<PaymentMode>('Cash');
  const [paymentLocked, setPaymentLocked] = useState(init.status === 'paid');

  // Linked decors (decors that reference this booking)
  const [linkedDecors, setLinkedDecors]       = useState<DecorDoc[]>([]);
  const [allDecors, setAllDecors]             = useState<DecorDoc[]>([]);
  const [showDecorPicker, setShowDecorPicker] = useState(false);
  const [decorPickerSearch, setDecorPickerSearch] = useState('');
  const [linkingDecor, setLinkingDecor]       = useState(false);
  const [activeDecor, setActiveDecor]         = useState<{ decor: DecorDoc; mode: 'view' | 'edit' } | null>(null);

  const refreshLinked = useCallback(() => {
    decorsApi.getAll({ bookingId: booking.id }).then(setLinkedDecors).catch(() => {});
  }, [booking.id]);

  useEffect(() => {
    refreshLinked();
    decorsApi.getAll().then(setAllDecors).catch(() => {});
  }, [init.id]);

  async function linkDecor(decor: DecorDoc) {
    setLinkingDecor(true);
    try {
      await decorsApi.update(decor._id, { bookingId: booking.id });
      // decorCost is auto-set on backend; update local booking state
      const decorCost = decor.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
      const updated = { ...booking, decorCost };
      setBooking(updated);
      setDecorInput(decorCost.toString());
      onUpdate(updated).catch(() => {});
      await refreshLinked();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLinkingDecor(false);
      setShowDecorPicker(false);
    }
  }

  async function unlinkDecor(decor: DecorDoc) {
    const doUnlink = async () => {
      try {
        await decorsApi.update(decor._id, { bookingId: null });
        const updated = { ...booking, decorCost: undefined };
        setBooking(updated);
        setDecorInput('');
        onUpdate(updated).catch(() => {});
        await refreshLinked();
      } catch (e: any) {
        Alert.alert('Error', e.message);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Unlink "${decor.eventName}" from this booking?`)) doUnlink();
    } else {
      Alert.alert('Unlink Decor', `Remove "${decor.eventName}" from this booking?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unlink', style: 'destructive', onPress: doUnlink },
      ]);
    }
  }

  function handleDecorSaved(updated: DecorDoc) {
    setActiveDecor(prev => prev ? { ...prev, decor: updated } : null);
    setLinkedDecors(prev => prev.map(d => d._id === updated._id ? updated : d));
    const newCost = updated.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
    const refreshedBooking = { ...booking, decorCost: newCost };
    setBooking(refreshedBooking);
    onUpdate(refreshedBooking).catch(() => {});
  }

  const router = useRouter();

  function push(updated: Booking) {
    setBooking(updated);
    onUpdate(updated).catch((e: any) => Alert.alert('Save error', e.message));
  }

  // ── Edit save ──
  const [savingEdit, setSavingEdit] = useState(false);

  async function saveEdits() {
    if (!editForm.client.trim())    return Alert.alert('Required', 'Enter client name.');
    if (!editForm.phone.trim())     return Alert.alert('Required', 'Enter phone number.');
    if (!editForm.eventName.trim()) return Alert.alert('Required', 'Enter event name.');
    if (!isValidDate(editForm.date)) return Alert.alert('Invalid Date', 'Enter date as YYYY-MM-DD.');
    if (!editForm.guestCount || isNaN(Number(editForm.guestCount))) return Alert.alert('Required', 'Enter a valid guest count.');
    if (!editForm.amount || isNaN(Number(editForm.amount))) return Alert.alert('Required', 'Enter a valid total cost.');

    const updated: Booking = {
      ...booking,
      client:     editForm.client.trim(),
      phone:      editForm.phone.trim(),
      eventName:  editForm.eventName.trim(),
      venue:      editForm.venue,
      date:       editForm.date,
      slot:       editForm.slot,
      guestCount: Number(editForm.guestCount),
      amount:     Number(editForm.amount),
      status:     editForm.status,
    };
    setSavingEdit(true);
    try {
      await onUpdate(updated);
      setBooking(updated);
      setIsEditing(false);
    } catch (e: any) {
      Alert.alert('Save error', e.message);
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Status ──
  function changeStatus(status: BookingStatus) {
    push({ ...booking, status });
  }

  // ── Readings ──
  function saveReadings() {
    const s = Number(startR), e = Number(endR);
    if (!startR || !endR || isNaN(s) || isNaN(e)) return Alert.alert('Invalid', 'Enter valid meter readings.');
    if (e < s) return Alert.alert('Invalid', 'End reading must be ≥ start reading.');
    push({ ...booking, startReading: s, endReading: e });
  }
  function clearReadings() {
    setStartR(''); setEndR('');
    push({ ...booking, startReading: undefined, endReading: undefined });
  }

  // ── AC ──
  function saveAcHours() {
    const val = Number(acInput);
    if (!acInput.trim() || isNaN(val) || val < 0) return Alert.alert('Invalid', 'Enter a valid number of hours (e.g. 2 or 2.5).');
    push({ ...booking, acHours: val });
  }
  function clearAcHours() {
    setAcInput('');
    push({ ...booking, acHours: undefined });
  }

  // ── Decor ──
  function saveDecorCost() {
    if (!decorInput.trim()) return push({ ...booking, decorCost: undefined });
    const val = Number(decorInput);
    if (isNaN(val) || val < 0) return Alert.alert('Invalid', 'Enter a valid decor cost.');
    push({ ...booking, decorCost: val });
  }
  function clearDecorCost() {
    setDecorInput('');
    push({ ...booking, decorCost: undefined });
  }

  // ── Extra Benefits ──
  function addExtraBenefit() {
    if (!benefitName.trim()) return Alert.alert('Required', 'Enter a benefit name.');
    if (!benefitAmount || isNaN(Number(benefitAmount))) return Alert.alert('Required', 'Enter a valid amount.');
    const benefit: ExtraBenefit = { id: Date.now().toString(), name: benefitName.trim(), amount: Number(benefitAmount) };
    push({ ...booking, extraBenefits: [...booking.extraBenefits, benefit] });
    setBenefitName(''); setBenefitAmount('');
  }
  function removeExtraBenefit(id: string) {
    push({ ...booking, extraBenefits: booking.extraBenefits.filter(b => b.id !== id) });
  }

  // ── Payments ──
  function resetPayForm() {
    setPayAmount(''); setPayDate(nowDate()); setPayTime(nowTime()); setPayMode('Cash');
    setEditingPaymentId(null);
  }
  function addPayment() {
    if (!payAmount || isNaN(Number(payAmount)) || Number(payAmount) <= 0)
      return Alert.alert('Invalid', 'Enter a valid payment amount.');
    if (!isValidDate(payDate)) return Alert.alert('Invalid', 'Enter date as YYYY-MM-DD.');
    if (editingPaymentId) {
      push({
        ...booking,
        payments: booking.payments.map(p =>
          p.id === editingPaymentId
            ? { ...p, amount: Number(payAmount), mode: payMode, date: payDate, time: payTime }
            : p
        ),
      });
    } else {
      push({ ...booking, payments: [...booking.payments, { id: Date.now().toString(), amount: Number(payAmount), mode: payMode, date: payDate, time: payTime }] });
    }
    resetPayForm();
  }
  function editPayment(p: Payment) {
    setEditingPaymentId(p.id);
    setPayMode(p.mode);
    setPayAmount(p.amount.toString());
    setPayDate(p.date);
    setPayTime(p.time);
  }
  function removePayment(id: string) {
    if (editingPaymentId === id) resetPayForm();
    push({ ...booking, payments: booking.payments.filter(p => p.id !== id) });
  }
  function recordBalancePayment() {
    const amt = Number(balAmount);
    if (!balAmount || isNaN(amt) || amt <= 0) return Alert.alert('Invalid', 'Enter a valid payment amount.');
    push({ ...booking, payments: [...booking.payments, { id: Date.now().toString(), amount: amt, mode: balMode, date: nowDate(), time: nowTime() }] });
    setBalAmount('');
  }
  function settleBooking() {
    const owing = totalCost(booking) - totalAdvancePaid(booking) - (booking.discount ?? 0);
    if (owing <= 0) { Alert.alert('Already Settled', 'No outstanding balance.'); return; }

    const enteredAmt    = Number(balAmount) || 0;
    const finalAmt      = Math.max(0, Math.min(enteredAmt, owing));
    const discountGiven = owing - finalAmt;

    const msgParts: string[] = [];
    if (finalAmt > 0)      msgParts.push(`Amount collected: ${fmtMoney(finalAmt)}`);
    if (discountGiven > 0) msgParts.push(`Discount given: ${fmtMoney(discountGiven)}`);
    msgParts.push('Status will change to Paid.');

    function doSettle() {
      const newPayments = finalAmt > 0
        ? [...booking.payments, { id: Date.now().toString(), amount: finalAmt, mode: balMode, date: nowDate(), time: nowTime() }]
        : [...booking.payments];
      const settled: Booking = {
        ...booking,
        status: 'paid',
        discount: (booking.discount ?? 0) + discountGiven,
        payments: newPayments,
      };
      push(settled);
      setBalAmount('');
      setPaymentLocked(true);
      printBooking(settled);
    }

    if (Platform.OS === 'web') {
      if (window.confirm(msgParts.join('\n'))) doSettle();
    } else {
      Alert.alert('Payment Completed', msgParts.join('\n'), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: doSettle },
      ]);
    }
  }

  // ── Expenses ──
  function addExpense() {
    if (!expTitle.trim()) return Alert.alert('Required', 'Enter expense title.');
    if (!expAmount || isNaN(Number(expAmount))) return Alert.alert('Required', 'Enter a valid amount.');
    push({ ...booking, expenses: [...booking.expenses, { id: Date.now().toString(), title: expTitle.trim(), amount: Number(expAmount) }] });
    setExpTitle(''); setExpAmount('');
  }
  function removeExpense(id: string) {
    push({ ...booking, expenses: booking.expenses.filter(e => e.id !== id) });
  }

  const ec      = elecCharge(booking);
  const ac      = acCharge(booking);
  const acCost  = acInternalCost(booking);
  const tc      = totalCost(booking);
  const te      = totalExpenses(booking);
  const balance        = tc - totalAdvancePaid(booking);
  const displayBalance = effectiveBalance(booking);
  const net            = netEarned(booking);
  const discountAmt    = booking.discount ?? 0;

  const statusColor: Record<BookingStatus, string> = {
    confirmed: '#27ae60', pending: '#f39c12', cancelled: '#e74c3c', paid: '#1abc9c',
  };
  const detBadgeLabel =
    booking.status === 'paid' ? '✓ PAYMENT COMPLETED' :
    booking.status === 'cancelled' ? 'CANCELLED' :
    displayBalance > 0 ? 'PAYMENT PENDING' :
    booking.status.toUpperCase();
  const detBadgeColor =
    booking.status === 'paid' ? '#1abc9c' :
    booking.status === 'cancelled' ? '#e74c3c' :
    displayBalance > 0 ? '#e67e22' :
    statusColor[booking.status];

  // ════════════════════════════════════════════════════════
  // EDIT MODE
  // ════════════════════════════════════════════════════════
  if (isEditing) {
    return (
      <Modal transparent animationType="slide" onRequestClose={() => setIsEditing(false)}>
        <View style={det.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setIsEditing(false)} activeOpacity={1} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
            <View style={form_s.sheet}>
            <View style={modal.handle} />
            <View style={det.editHeader}>
              <Text style={form_s.title}>Edit Booking</Text>
              <TouchableOpacity onPress={() => setIsEditing(false)} style={det.editCloseBtn}>
                <Text style={det.editCloseTxt}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <Text style={form_s.label}>Venue</Text>
              <View style={form_s.toggle}>
                {VENUE_OPTIONS.map(v => (
                  <TouchableOpacity key={v} style={[form_s.toggleBtn, editForm.venue === v && form_s.toggleBtnActive]} onPress={() => setEditForm(f => ({ ...f, venue: v }))}>
                    <Text style={[form_s.toggleTxt, editForm.venue === v && form_s.toggleTxtActive]}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={form_s.label}>Client Name *</Text>
              <TextInput style={form_s.input} placeholder="e.g. Ravi & Priya" value={editForm.client} onChangeText={v => setEditForm(f => ({ ...f, client: v }))} />

              <Text style={form_s.label}>Phone Number *</Text>
              <TextInput style={form_s.input} placeholder="10-digit mobile" keyboardType="phone-pad" value={editForm.phone} onChangeText={v => setEditForm(f => ({ ...f, phone: v }))} maxLength={10} />

              <Text style={form_s.label}>Event Name *</Text>
              <TextInput style={form_s.input} placeholder="e.g. Wedding, Birthday" value={editForm.eventName} onChangeText={v => setEditForm(f => ({ ...f, eventName: v }))} />

              <Text style={form_s.label}>Event Date *</Text>
              <DatePickerField value={editForm.date} onChange={v => setEditForm(f => ({ ...f, date: v }))} />

              <Text style={form_s.label}>Slot</Text>
              <View style={form_s.toggle}>
                {(['morning', 'evening'] as Slot[]).map(s => (
                  <TouchableOpacity key={s} style={[form_s.toggleBtn, editForm.slot === s && form_s.toggleBtnActive]} onPress={() => setEditForm(f => ({ ...f, slot: s }))}>
                    <Text style={[form_s.toggleTxt, editForm.slot === s && form_s.toggleTxtActive]}>{s === 'morning' ? '🌅 Morning' : '🌆 Evening'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={form_s.label}>Guest Count *</Text>
              <TextInput style={form_s.input} placeholder="e.g. 500" keyboardType="number-pad" value={editForm.guestCount} onChangeText={v => setEditForm(f => ({ ...f, guestCount: v }))} />

              <Text style={form_s.label}>Base Venue Cost (₹) *</Text>
              <TextInput style={form_s.input} placeholder="e.g. 150000" keyboardType="number-pad" value={editForm.amount} onChangeText={v => setEditForm(f => ({ ...f, amount: v }))} />

              <Text style={form_s.label}>Status</Text>
              <View style={form_s.toggle}>
                {(['pending', 'confirmed', 'cancelled'] as BookingStatus[]).map(s => (
                  <TouchableOpacity key={s} style={[form_s.toggleBtn, editForm.status === s && form_s.toggleBtnActive, s === 'cancelled' && editForm.status === s && { backgroundColor: '#e74c3c', borderColor: '#e74c3c' }]} onPress={() => setEditForm(f => ({ ...f, status: s }))}>
                    <Text style={[form_s.toggleTxt, editForm.status === s && form_s.toggleTxtActive]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={form_s.actions}>
                <TouchableOpacity style={form_s.cancelBtn} onPress={() => setIsEditing(false)} disabled={savingEdit}><Text style={form_s.cancelTxt}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={form_s.saveBtn} onPress={saveEdits} disabled={savingEdit}><Text style={form_s.saveTxt}>{savingEdit ? 'Saving…' : 'Save Changes'}</Text></TouchableOpacity>
              </View>
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW MODE
  // ════════════════════════════════════════════════════════
  return (
    <>
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={det.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <View style={det.sheet}>
            <View style={det.handle} />

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Header row with Edit button ── */}
            <View style={det.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={det.title}>{booking.venue}</Text>
                <View style={[det.statusBadge, { backgroundColor: detBadgeColor + '22', alignSelf: 'flex-start', marginTop: 4 }]}>
                  <Text style={[det.statusText, { color: detBadgeColor }]}>{detBadgeLabel}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={det.printBtn} onPress={() => printBooking(booking)}>
                  <Text style={det.printBtnTxt}>🖨️  Print</Text>
                </TouchableOpacity>
                {booking.status === 'paid' && paymentLocked && (
                  <TouchableOpacity style={det.editPayBtn} onPress={() => {
                    push({ ...booking, discount: undefined, status: 'confirmed' });
                    setPaymentLocked(false);
                    setBalAmount('');
                  }}>
                    <Text style={det.editPayTxt}>✏️ Edit Payment</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={det.editBtn} onPress={() => setIsEditing(true)}>
                  <Text style={det.editBtnTxt}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Paid Banner ── */}
            {booking.status === 'paid' && (
              <View style={det.paidTopBanner}>
                <Text style={det.paidTopBannerTxt}>✓  PAID — Payment Completed</Text>
                <Text style={det.paidTopSub}>All payments have been settled for this booking</Text>
              </View>
            )}

            {/* ── Booking Details Card ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>Booking Details</Text>
              <View style={det.detRow}><Text style={det.detLabel}>Client</Text><Text style={det.detVal}>{booking.client}</Text></View>
              <View style={det.detRow}><Text style={det.detLabel}>Phone</Text><Text style={det.detVal}>{booking.phone}</Text></View>
              <View style={det.divider} />
              <View style={det.detRow}><Text style={det.detLabel}>Event</Text><Text style={det.detVal}>{booking.eventName}</Text></View>
              <View style={det.detRow}><Text style={det.detLabel}>Guests</Text><Text style={det.detVal}>{booking.guestCount}</Text></View>
              <View style={det.detRow}><Text style={det.detLabel}>Date</Text><Text style={det.detVal}>{booking.date}</Text></View>
              <View style={det.detRow}><Text style={det.detLabel}>Slot</Text><Text style={det.detVal}>{booking.slot === 'morning' ? '🌅 Morning' : '🌆 Evening'}</Text></View>
            </View>

            {/* ── Status Actions ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>Change Status</Text>
              {booking.status === 'paid' ? (
                <View style={det.paidBanner}>
                  <Text style={det.paidBannerTxt}>✓  Payment Completed</Text>
                  <TouchableOpacity onPress={() => changeStatus('confirmed')}>
                    <Text style={det.paidReopenTxt}>Reopen</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={det.actionRow}>
                  {booking.status !== 'confirmed' && (
                    <TouchableOpacity style={det.confirmBtn} onPress={() => changeStatus('confirmed')}>
                      <Text style={det.confirmTxt}>✓  Confirm</Text>
                    </TouchableOpacity>
                  )}
                  {booking.status !== 'cancelled' && (
                    <TouchableOpacity style={det.cancelBtn} onPress={() =>
                      Alert.alert('Cancel Booking', 'Mark this booking as cancelled?', [
                        { text: 'No', style: 'cancel' },
                        { text: 'Yes, Cancel', style: 'destructive', onPress: () => changeStatus('cancelled') },
                      ])
                    }>
                      <Text style={det.cancelTxt}>✕  Cancel</Text>
                    </TouchableOpacity>
                  )}
                  {booking.status === 'cancelled' && (
                    <TouchableOpacity style={det.confirmBtn} onPress={() => changeStatus('pending')}>
                      <Text style={det.confirmTxt}>↩  Restore to Pending</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* ── Payment History ── */}
            <View style={det.sectionCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={det.sectionTitle}>💳 Payment History</Text>
                {paymentLocked && booking.status === 'paid' && (
                  <Text style={{ fontSize: 11, color: '#1abc9c', fontWeight: '700' }}>🔒 Locked</Text>
                )}
              </View>
              <Text style={det.sectionHint}>Payments received from customer</Text>

              {booking.payments.length > 0 ? (
                <>
                  {booking.payments.map(p => (
                    <View key={p.id} style={[pay_s.payItem, editingPaymentId === p.id && pay_s.payItemEditing]}>
                      <View style={pay_s.payTopRow}>
                        <View style={pay_s.payMode}>
                          <Text style={{ fontSize: 16 }}>{MODE_ICON[p.mode]}</Text>
                          <Text style={pay_s.payModeText}>{p.mode}</Text>
                        </View>
                        <Text style={pay_s.payAmount}>{fmtMoney(p.amount)}</Text>
                        {!paymentLocked && (
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            <TouchableOpacity onPress={() => editPayment(p)} style={pay_s.payEdit}>
                              <Text style={pay_s.payEditTxt}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => removePayment(p.id)} style={pay_s.payDel}>
                              <Text style={pay_s.payDelTxt}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                      <Text style={pay_s.payMeta}>{p.date}  ·  {p.time}</Text>
                    </View>
                  ))}
                  <View style={pay_s.totalRow}>
                    <Text style={pay_s.totalLabel}>Total Paid</Text>
                    <Text style={pay_s.totalVal}>{fmtMoney(totalAdvancePaid(booking))}</Text>
                  </View>
                </>
              ) : (
                <Text style={det.emptyHint}>No payments recorded yet</Text>
              )}

              {paymentLocked && booking.status === 'paid' ? (
                <View style={det.payLockedNote}>
                  <Text style={det.payLockedTxt}>🔒  Payments are locked.  Tap "Edit Payment" at the top to modify.</Text>
                </View>
              ) : (
                <View style={{ marginTop: 14 }}>
                  {editingPaymentId && (
                    <View style={pay_s.editBanner}>
                      <Text style={pay_s.editBannerTxt}>Editing payment — make changes below</Text>
                      <TouchableOpacity onPress={resetPayForm}>
                        <Text style={pay_s.editBannerCancel}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <Text style={det.inputLabel}>Payment Mode</Text>
                  <View style={pay_s.modeRow}>
                    {PAYMENT_MODES.map(m => (
                      <TouchableOpacity key={m} style={[pay_s.modeChip, payMode === m && pay_s.modeChipActive]} onPress={() => setPayMode(m)}>
                        <Text style={[pay_s.modeTxt, payMode === m && pay_s.modeTxtActive]}>{MODE_ICON[m]} {m}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={det.inputLabel}>Amount (₹)</Text>
                  <TextInput
                    style={det.input}
                    placeholder="e.g. 25000"
                    keyboardType="number-pad"
                    value={payAmount}
                    onChangeText={setPayAmount}
                  />
                  <View style={[pay_s.dtRow, { marginTop: 8 }]}>
                    <DatePickerField value={payDate} onChange={setPayDate} style={{ flex: 1 }} />
                    <TextInput
                      style={[det.input, { flex: 1, marginLeft: 8 }]}
                      placeholder="HH:MM"
                      keyboardType="numbers-and-punctuation"
                      value={payTime}
                      onChangeText={setPayTime}
                      maxLength={5}
                    />
                  </View>
                  <TouchableOpacity style={[det.saveBtn, { marginTop: 10, backgroundColor: editingPaymentId ? '#f39c12' : '#7B61FF' }]} onPress={addPayment}>
                    <Text style={det.saveTxt}>{editingPaymentId ? '✓  Update Payment' : '+ Add Payment'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* ── Electricity Reading ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>⚡ Electricity Reading</Text>

              {/* Inputs */}
              <View style={det.readingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={det.inputLabel}>Start Reading</Text>
                  <TextInput
                    style={det.input}
                    placeholder="e.g. 1200"
                    keyboardType="number-pad"
                    value={startR}
                    onChangeText={setStartR}
                  />
                </View>
                <View style={det.readingArrow}><Text style={det.arrowTxt}>→</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={det.inputLabel}>End Reading</Text>
                  <TextInput
                    style={det.input}
                    placeholder="e.g. 1350"
                    keyboardType="number-pad"
                    value={endR}
                    onChangeText={setEndR}
                  />
                </View>
              </View>

              {/* Live breakdown */}
              {(() => {
                const s = Number(startR), e = Number(endR);
                const valid = startR && endR && !isNaN(s) && !isNaN(e) && e >= s;
                if (!valid) return (
                  <View style={det.calcHint}>
                    <Text style={det.calcHintText}>Enter start and end readings to see the charge</Text>
                  </View>
                );
                const units    = e - s;
                const charge   = units * 20;
                const newTotal = booking.amount + charge;
                return (
                  <View style={det.calcCard}>
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>Units Used</Text>
                      <Text style={det.calcValue}>{units} units</Text>
                    </View>
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>Rate per Unit</Text>
                      <Text style={det.calcValue}>₹20</Text>
                    </View>
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>Electricity Charge</Text>
                      <Text style={[det.calcValue, { color: '#e67e22', fontWeight: '700' }]}>{fmtMoney(charge)}</Text>
                    </View>
                    <View style={det.calcDivider} />
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>Base Venue Cost</Text>
                      <Text style={det.calcValue}>{fmtMoney(booking.amount)}</Text>
                    </View>
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>+ Electricity</Text>
                      <Text style={[det.calcValue, { color: '#e67e22' }]}>+ {fmtMoney(charge)}</Text>
                    </View>
                    <View style={[det.calcRow, det.calcTotalRow]}>
                      <Text style={det.calcTotalLabel}>Customer Total</Text>
                      <Text style={det.calcTotalValue}>{fmtMoney(newTotal)}</Text>
                    </View>
                  </View>
                );
              })()}

              <View style={[det.actionRow, { marginTop: 12 }]}>
                <TouchableOpacity style={det.saveBtn} onPress={saveReadings}>
                  <Text style={det.saveTxt}>Save &amp; Apply to Total</Text>
                </TouchableOpacity>
                {booking.startReading != null && (
                  <TouchableOpacity style={det.ghostBtn} onPress={clearReadings}>
                    <Text style={det.ghostTxt}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>

              {booking.startReading != null && (
                <View style={det.savedBadge}>
                  <Text style={det.savedBadgeText}>
                    ✓  Saved: {booking.startReading} → {booking.endReading}  ·  {fmtMoney(ec)} added to total
                  </Text>
                </View>
              )}
            </View>

            {/* ── AC Usage ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>❄️ AC Usage</Text>
              <Text style={det.sectionHint}>₹3,500 per hour — added to customer total</Text>

              <Text style={det.inputLabel}>Hours Used</Text>
              <TextInput
                style={det.input}
                placeholder="e.g. 2 or 2.5"
                keyboardType="decimal-pad"
                value={acInput}
                onChangeText={setAcInput}
              />

              {(() => {
                const hrs = Number(acInput);
                if (!acInput.trim() || isNaN(hrs) || hrs <= 0) return (
                  <View style={det.calcHint}>
                    <Text style={det.calcHintText}>Enter hours to see the AC charge</Text>
                  </View>
                );
                const charge = hrs * 3500;
                return (
                  <View style={[det.calcCard, { backgroundColor: '#eaf4ff', borderColor: '#a8d4f5' }]}>
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>Hours Used</Text>
                      <Text style={det.calcValue}>{hrs} hr{hrs !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={det.calcRow}>
                      <Text style={det.calcLabel}>Rate per Hour</Text>
                      <Text style={det.calcValue}>₹3,500</Text>
                    </View>
                    <View style={det.calcDivider} />
                    <View style={[det.calcRow, det.calcTotalRow]}>
                      <Text style={det.calcTotalLabel}>AC Charge</Text>
                      <Text style={[det.calcTotalValue, { color: '#2980b9' }]}>{fmtMoney(charge)}</Text>
                    </View>
                  </View>
                );
              })()}

              <View style={[det.actionRow, { marginTop: 12 }]}>
                <TouchableOpacity style={[det.saveBtn, { backgroundColor: '#2980b9' }]} onPress={saveAcHours}>
                  <Text style={det.saveTxt}>Save &amp; Apply to Total</Text>
                </TouchableOpacity>
                {(booking.acHours ?? 0) > 0 && (
                  <TouchableOpacity style={det.ghostBtn} onPress={clearAcHours}>
                    <Text style={det.ghostTxt}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>

              {(booking.acHours ?? 0) > 0 && (
                <View style={[det.savedBadge, { backgroundColor: '#2980b915', borderColor: '#2980b940' }]}>
                  <Text style={[det.savedBadgeText, { color: '#2980b9' }]}>
                    ✓  Saved: {booking.acHours} hr{booking.acHours !== 1 ? 's' : ''}  ·  {fmtMoney(ac)} added to total
                  </Text>
                </View>
              )}
            </View>

            {/* ── Decor Cost ── */}
            <View style={det.sectionCard}>
              <View style={det.decorHeader}>
                <View>
                  <Text style={det.sectionTitle}>🎨 Decor</Text>
                  <Text style={det.sectionHint}>Link a decor entry or enter manually</Text>
                </View>
                <TouchableOpacity style={det.decorPageBtn} onPress={() => { onClose(); router.push('/(tabs)/decor' as any); }}>
                  <Text style={det.decorPageTxt}>Decor Page →</Text>
                </TouchableOpacity>
              </View>

              {/* ── Linked decor cards ── */}
              {linkedDecors.map(d => {
                const decorTotal  = d.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
                const paid        = d.advanceAmount + d.settledAmount;
                const balance     = Math.max(0, decorTotal - paid);
                const sc = d.paymentStatus === 'completed' ? '#27ae60' : d.paymentStatus === 'partial' ? '#f39c12' : '#e74c3c';
                return (
                  <View key={d._id} style={{ borderWidth: 1.5, borderColor: '#8e44ad40', borderRadius: 12, padding: 14, marginBottom: 12, backgroundColor: '#8e44ad06' }}>
                    {/* Header row */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800', color: '#1A1A2E', fontSize: 15 }} numberOfLines={1}>{d.eventName}</Text>
                        <Text style={{ color: '#666', fontSize: 12, marginTop: 1 }}>{d.customerName}  ·  {d.mobile}</Text>
                      </View>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: sc + '20', marginLeft: 8 }}>
                        <Text style={{ color: sc, fontSize: 11, fontWeight: '700' }}>
                          {d.paymentStatus.charAt(0).toUpperCase() + d.paymentStatus.slice(1)}
                        </Text>
                      </View>
                    </View>

                    {/* Action buttons */}
                    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                      <TouchableOpacity onPress={() => setActiveDecor({ decor: d, mode: 'view' })}
                        style={{ flex: 1, paddingVertical: 6, borderRadius: 7, backgroundColor: '#3498db15', borderWidth: 1, borderColor: '#3498db40', alignItems: 'center' }}>
                        <Text style={{ color: '#3498db', fontSize: 11, fontWeight: '700' }}>👁 View</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setActiveDecor({ decor: d, mode: 'edit' })}
                        style={{ flex: 1, paddingVertical: 6, borderRadius: 7, backgroundColor: '#8e44ad15', borderWidth: 1, borderColor: '#8e44ad40', alignItems: 'center' }}>
                        <Text style={{ color: '#8e44ad', fontSize: 11, fontWeight: '700' }}>✏️ Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => printDecorDoc(d)}
                        style={{ flex: 1, paddingVertical: 6, borderRadius: 7, backgroundColor: '#27ae6015', borderWidth: 1, borderColor: '#27ae6040', alignItems: 'center' }}>
                        <Text style={{ color: '#27ae60', fontSize: 11, fontWeight: '700' }}>🖨 Print</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => unlinkDecor(d)}
                        style={{ flex: 1, paddingVertical: 6, borderRadius: 7, backgroundColor: '#e74c3c12', borderWidth: 1, borderColor: '#e74c3c40', alignItems: 'center' }}>
                        <Text style={{ color: '#e74c3c', fontSize: 11, fontWeight: '700' }}>✕ Unlink</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Event details */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {[
                        d.eventType && { label: d.eventType, color: '#8e44ad' },
                        d.eventDate && { label: '📅 ' + d.eventDate, color: '#555' },
                        d.location  && { label: '📍 ' + d.location,  color: '#555' },
                      ].filter(Boolean).map((tag: any) => (
                        <View key={tag.label} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#f0f0f8', borderWidth: 1, borderColor: '#e0e0f0' }}>
                          <Text style={{ fontSize: 11, color: tag.color }}>{tag.label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Decor items list */}
                    {d.decorItems.length > 0 && (
                      <View style={{ marginBottom: 10, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' }}>
                        <View style={{ flexDirection: 'row', backgroundColor: '#f5f5fb', padding: 8 }}>
                          <Text style={{ flex: 3, fontSize: 11, fontWeight: '700', color: '#555' }}>ITEM</Text>
                          <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', color: '#555', textAlign: 'right' }}>QTY</Text>
                          <Text style={{ flex: 2, fontSize: 11, fontWeight: '700', color: '#555', textAlign: 'right' }}>RATE</Text>
                          <Text style={{ flex: 2, fontSize: 11, fontWeight: '700', color: '#555', textAlign: 'right' }}>TOTAL</Text>
                        </View>
                        {d.decorItems.map((item, i) => (
                          <View key={item._id ?? i} style={{ flexDirection: 'row', padding: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' }}>
                            <Text style={{ flex: 3, fontSize: 12, color: '#333' }} numberOfLines={1}>{item.name}</Text>
                            <Text style={{ flex: 1, fontSize: 12, color: '#555', textAlign: 'right' }}>{item.quantity}</Text>
                            <Text style={{ flex: 2, fontSize: 12, color: '#555', textAlign: 'right' }}>{fmtMoney(item.costPerUnit)}</Text>
                            <Text style={{ flex: 2, fontSize: 12, fontWeight: '600', color: '#333', textAlign: 'right' }}>{fmtMoney(item.quantity * item.costPerUnit)}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Payment tiles */}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {[
                        ['Total Cost',   fmtMoney(decorTotal),        '#8e44ad'],
                        ['Advance',      fmtMoney(d.advanceAmount),   '#27ae60'],
                        ['Settled',      fmtMoney(d.settledAmount),   '#27ae60'],
                        ['Balance',      fmtMoney(balance), balance > 0 ? '#e74c3c' : '#27ae60'],
                      ].map(([lbl, val, col]) => (
                        <View key={lbl as string} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 8, padding: 7, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' }}>
                          <Text style={{ fontSize: 9, color: '#9B98C0', marginBottom: 2 }}>{lbl}</Text>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: col as string }}>{val}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Comments */}
                    {!!d.comments && (
                      <Text style={{ marginTop: 8, fontSize: 12, color: '#666', fontStyle: 'italic' }}>"{d.comments}"</Text>
                    )}
                  </View>
                );
              })}

              {/* ── Add decor button ── */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#8e44ad60', borderStyle: 'dashed', borderRadius: 10, padding: 12, marginBottom: 12, backgroundColor: '#8e44ad06' }}
                onPress={() => { setDecorPickerSearch(''); setShowDecorPicker(true); }}
                disabled={linkingDecor}
              >
                <Text style={{ color: '#8e44ad', fontSize: 14, fontWeight: '700' }}>
                  {linkingDecor ? '⏳ Linking…' : `🔗  ${linkedDecors.length > 0 ? 'Add Another Decor' : 'Select a Decor'}`}
                </Text>
              </TouchableOpacity>

              {/* ── Manual amount (fallback for externally managed decor) ── */}
              {linkedDecors.length === 0 && (
                <>
                  <Text style={[det.sectionHint, { marginBottom: 6 }]}>Or enter decor cost manually:</Text>
                  <Text style={det.inputLabel}>Decor Amount (₹)</Text>
                  <TextInput
                    style={det.input}
                    placeholder="e.g. 25000"
                    keyboardType="number-pad"
                    value={decorInput}
                    onChangeText={setDecorInput}
                  />
                  {decorInput && !isNaN(Number(decorInput)) && Number(decorInput) > 0 ? (
                    <View style={det.decorCalcCard}>
                      <View style={det.calcRow}>
                        <Text style={det.calcLabel}>Base Venue Cost</Text>
                        <Text style={det.calcValue}>{fmtMoney(booking.amount)}</Text>
                      </View>
                      {ec > 0 && (
                        <View style={det.calcRow}>
                          <Text style={det.calcLabel}>+ Electricity</Text>
                          <Text style={det.calcValue}>{fmtMoney(ec)}</Text>
                        </View>
                      )}
                      <View style={det.calcRow}>
                        <Text style={det.calcLabel}>+ Decor</Text>
                        <Text style={[det.calcValue, { color: '#8e44ad', fontWeight: '700' }]}>{fmtMoney(Number(decorInput))}</Text>
                      </View>
                      <View style={det.calcDivider} />
                      <View style={det.calcRow}>
                        <Text style={det.calcTotalLabel}>Customer Total</Text>
                        <Text style={[det.calcTotalValue, { color: '#8e44ad' }]}>{fmtMoney(booking.amount + ec + Number(decorInput))}</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={[det.actionRow, { marginTop: 12 }]}>
                    <TouchableOpacity style={[det.saveBtn, { backgroundColor: '#8e44ad' }]} onPress={saveDecorCost}>
                      <Text style={det.saveTxt}>Save &amp; Apply to Total</Text>
                    </TouchableOpacity>
                    {(booking.decorCost ?? 0) > 0 && (
                      <TouchableOpacity style={det.ghostBtn} onPress={clearDecorCost}>
                        <Text style={det.ghostTxt}>Clear</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {(booking.decorCost ?? 0) > 0 && (
                    <View style={[det.savedBadge, { backgroundColor: '#8e44ad15', borderColor: '#8e44ad40' }]}>
                      <Text style={[det.savedBadgeText, { color: '#8e44ad' }]}>
                        ✓  Saved: {fmtMoney(booking.decorCost!)} added to customer total
                      </Text>
                    </View>
                  )}
                </>
              )}

              {linkedDecors.length > 0 && (booking.decorCost ?? 0) > 0 && (
                <View style={[det.savedBadge, { backgroundColor: '#8e44ad15', borderColor: '#8e44ad40' }]}>
                  <Text style={[det.savedBadgeText, { color: '#8e44ad' }]}>
                    ✓  Decor total {fmtMoney(booking.decorCost!)} added to customer total
                  </Text>
                </View>
              )}
            </View>

            {/* ── Other Expenses ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>Other Expenses</Text>
              <Text style={det.sectionHint}>Deducted from total to compute net earned</Text>
              {booking.expenses.length > 0 ? (
                <View style={det.expList}>
                  {booking.expenses.map(e => (
                    <View key={e.id} style={det.expItem}>
                      <Text style={det.expTitle}>{e.title}</Text>
                      <Text style={det.expAmount}>{fmtMoney(e.amount)}</Text>
                      <TouchableOpacity onPress={() => removeExpense(e.id)} style={det.expDel}>
                        <Text style={det.expDelTxt}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <View style={det.expTotal}>
                    <Text style={det.expTotalLabel}>Total Expenses</Text>
                    <Text style={det.expTotalVal}>{fmtMoney(te)}</Text>
                  </View>
                </View>
              ) : (
                <Text style={det.emptyHint}>No expenses added yet</Text>
              )}
              <View style={det.expInputRow}>
                <TextInput style={[det.input, { flex: 2 }]} placeholder="Expense title" value={expTitle} onChangeText={setExpTitle} />
                <TextInput style={[det.input, { flex: 1, marginLeft: 8 }]} placeholder="₹ Amount" keyboardType="number-pad" value={expAmount} onChangeText={setExpAmount} />
              </View>
              <TouchableOpacity style={det.saveBtn} onPress={addExpense}>
                <Text style={det.saveTxt}>+ Add Expense</Text>
              </TouchableOpacity>
            </View>

            {/* ── Extra Benefits ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>🎁 Extra Benefits</Text>
              <Text style={det.sectionHint}>Add-ons charged to the customer — each item is added to their total bill</Text>

              {booking.extraBenefits.length > 0 ? (
                <View style={det.expList}>
                  {booking.extraBenefits.map(b => (
                    <View key={b.id} style={det.expItem}>
                      <Text style={det.expTitle}>{b.name}</Text>
                      <Text style={[det.expAmount, { color: '#27ae60' }]}>{fmtMoney(b.amount)}</Text>
                      <TouchableOpacity onPress={() => removeExtraBenefit(b.id)} style={det.expDel}>
                        <Text style={det.expDelTxt}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <View style={det.expTotal}>
                    <Text style={det.expTotalLabel}>Total Extra Benefits</Text>
                    <Text style={[det.expTotalVal, { color: '#27ae60' }]}>{fmtMoney(extraBenefitsTotal(booking))}</Text>
                  </View>
                </View>
              ) : (
                <Text style={det.emptyHint}>No extra benefits added yet</Text>
              )}

              <View style={det.expInputRow}>
                <TextInput
                  style={[det.input, { flex: 2 }]}
                  placeholder="e.g. Extra Chairs, Generator"
                  value={benefitName}
                  onChangeText={setBenefitName}
                />
                <TextInput
                  style={[det.input, { flex: 1, marginLeft: 8 }]}
                  placeholder="₹ Amount"
                  keyboardType="number-pad"
                  value={benefitAmount}
                  onChangeText={setBenefitAmount}
                />
              </View>
              <TouchableOpacity style={[det.saveBtn, { backgroundColor: '#27ae60' }]} onPress={addExtraBenefit}>
                <Text style={det.saveTxt}>+ Add Benefit</Text>
              </TouchableOpacity>
            </View>

            {/* ── Transaction Summary ── */}
            <View style={det.sectionCard}>
              <Text style={det.sectionTitle}>💰 Transaction Summary</Text>

              {/* Charges block */}
              <Text style={det.finBlockLabel}>Charges</Text>
              <View style={det.finBlock}>
                <View style={det.finBRow}>
                  <Text style={det.finBLabel}>Base Venue Cost</Text>
                  <Text style={det.finBVal}>{fmtMoney(booking.amount)}</Text>
                </View>
                {ec > 0 && (
                  <View style={det.finBRow}>
                    <Text style={det.finBLabel}>⚡ Electricity ({(booking.endReading ?? 0) - (booking.startReading ?? 0)} units × ₹20)</Text>
                    <Text style={[det.finBVal, { color: '#e67e22' }]}>{fmtMoney(ec)}</Text>
                  </View>
                )}
                {ac > 0 && (
                  <View style={det.finBRow}>
                    <Text style={det.finBLabel}>❄️ AC ({booking.acHours} hr{booking.acHours !== 1 ? 's' : ''} × ₹3,500)</Text>
                    <Text style={[det.finBVal, { color: '#2980b9' }]}>{fmtMoney(ac)}</Text>
                  </View>
                )}
                {(booking.decorCost ?? 0) > 0 && (
                  <View style={det.finBRow}>
                    <Text style={det.finBLabel}>🎨 Decor</Text>
                    <Text style={[det.finBVal, { color: '#8e44ad' }]}>{fmtMoney(booking.decorCost!)}</Text>
                  </View>
                )}
                {booking.extraBenefits.map(eb => (
                  <View key={eb.id} style={det.finBRow}>
                    <Text style={det.finBLabel}>🎁 {eb.name}</Text>
                    <Text style={[det.finBVal, { color: '#27ae60' }]}>{fmtMoney(eb.amount)}</Text>
                  </View>
                ))}
                {discountAmt > 0 && (
                  <>
                    <View style={[det.finBRow, { borderTopWidth: 1, borderTopColor: '#e0e4f0', marginTop: 4, paddingTop: 8 }]}>
                      <Text style={det.finBLabel}>Sub Total</Text>
                      <Text style={det.finBVal}>{fmtMoney(tc)}</Text>
                    </View>
                    <View style={det.finBRow}>
                      <Text style={[det.finBLabel, { color: '#27ae60', fontWeight: '700' }]}>🎁 Discount</Text>
                      <Text style={[det.finBVal, { color: '#27ae60', fontWeight: '700' }]}>− {fmtMoney(discountAmt)}</Text>
                    </View>
                  </>
                )}
                <View style={[det.finBRow, det.finBTotalRow]}>
                  <Text style={det.finBTotalLabel}>{discountAmt > 0 ? 'Net Payable' : 'Total Charged'}</Text>
                  <Text style={det.finBTotalVal}>{fmtMoney(tc - discountAmt)}</Text>
                </View>
              </View>

              {/* Payments received block */}
              <Text style={[det.finBlockLabel, { marginTop: 16 }]}>Payments Received</Text>
              <View style={det.finBlock}>
                {booking.payments.length === 0 ? (
                  <Text style={{ fontSize: 12, color: '#bbb', fontStyle: 'italic', paddingVertical: 6 }}>No payments recorded yet</Text>
                ) : (
                  booking.payments.map(p => (
                    <View key={p.id} style={det.finBRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={det.finBLabel}>{MODE_ICON[p.mode]}  {p.mode}</Text>
                        <Text style={{ fontSize: 11, color: '#9B98C0', marginTop: 1 }}>{p.date}  ·  {p.time}</Text>
                      </View>
                      <Text style={[det.finBVal, { color: '#27ae60' }]}>{fmtMoney(p.amount)}</Text>
                    </View>
                  ))
                )}
                {booking.payments.length > 0 && (
                  <View style={[det.finBRow, det.finBTotalRow]}>
                    <Text style={det.finBTotalLabel}>Total Paid</Text>
                    <Text style={[det.finBTotalVal, { color: '#27ae60' }]}>{fmtMoney(totalAdvancePaid(booking))}</Text>
                  </View>
                )}
              </View>

              {/* Balance status banner */}
              {displayBalance > 0 ? (
                <View style={[det.balanceDueBox, { backgroundColor: '#fff8ec', borderColor: '#f0c27f' }]}>
                  <View>
                    <Text style={[det.balanceDueLabel, { color: '#d35400' }]}>⏳ Payment Pending</Text>
                    <Text style={[det.balanceDueHint, { color: '#b7770d' }]}>Balance remaining to collect</Text>
                  </View>
                  <Text style={[det.balanceDueAmt, { color: '#d35400' }]}>{fmtMoney(displayBalance)}</Text>
                </View>
              ) : (
                <View style={det.fullyPaidBox}>
                  {discountAmt > 0 ? (
                    <Text style={det.fullyPaidTxt}>✓  Paid  ·  Discount given: {fmtMoney(discountAmt)}</Text>
                  ) : (
                    <Text style={det.fullyPaidTxt}>✓  Fully Paid — No balance due</Text>
                  )}
                </View>
              )}

              {/* Record balance / settle payment */}
              {displayBalance > 0 && !paymentLocked && (
                <View style={det.balPayBox}>
                  <Text style={det.balPayTitle}>Collect Payment</Text>
                  <Text style={{ fontSize: 11, color: '#999', marginBottom: 10 }}>
                    Enter the amount received. Tap <Text style={{ fontWeight: '700', color: '#f39c12' }}>Payment Completed</Text> to settle and close — even if a balance remains.
                  </Text>

                  <Text style={det.inputLabel}>Payment Mode</Text>
                  <View style={[pay_s.modeRow, { marginBottom: 10 }]}>
                    {PAYMENT_MODES.map(m => (
                      <TouchableOpacity key={m} style={[pay_s.modeChip, balMode === m && pay_s.modeChipActive]} onPress={() => setBalMode(m)}>
                        <Text style={[pay_s.modeTxt, balMode === m && pay_s.modeTxtActive]}>{MODE_ICON[m]} {m}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={det.inputLabel}>Final Amount (₹)</Text>
                    <TouchableOpacity
                      onPress={() => setBalAmount(balance.toString())}
                      style={{ backgroundColor: '#eaf4ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#a8d4f5' }}
                    >
                      <Text style={{ fontSize: 11, color: '#2980b9', fontWeight: '700' }}>Fill {fmtMoney(balance)} ↗</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={[det.input, { marginBottom: 12 }]}
                    placeholder={`e.g. ${balance}  (balance due: ${fmtMoney(balance)})`}
                    keyboardType="number-pad"
                    value={balAmount}
                    onChangeText={setBalAmount}
                  />

                  <View style={det.actionRow}>
                    <TouchableOpacity style={[det.saveBtn, { backgroundColor: '#27ae60' }]} onPress={recordBalancePayment}>
                      <Text style={det.saveTxt}>+ Partial Payment</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={det.settleBtn} onPress={settleBooking}>
                      <Text style={det.settleTxt}>✓ Payment Completed</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* ── Net Profit ── */}
            <View style={det.finSummaryCard}>
              <Text style={det.finSummaryTitle}>📊 Net Profit</Text>

              <View style={det.finRow}>
                <Text style={det.finLabel}>Total Revenue</Text>
                <Text style={det.finVal}>{fmtMoney(tc)}</Text>
              </View>
              {discountAmt > 0 && (
                <View style={det.finRow}>
                  <Text style={det.finLabel}>🎁 Discount Given</Text>
                  <Text style={[det.finVal, { color: '#ff7675' }]}>− {fmtMoney(discountAmt)}</Text>
                </View>
              )}
              {acCost > 0 && (
                <View style={det.finRow}>
                  <Text style={det.finLabel}>❄️ AC Internal ({booking.acHours} hr{booking.acHours !== 1 ? 's' : ''} × ₹1,500)</Text>
                  <Text style={[det.finVal, { color: '#ff7675' }]}>− {fmtMoney(acCost)}</Text>
                </View>
              )}
              {te > 0 && (
                <>
                  <View style={det.finRow}>
                    <Text style={det.finLabel}>Other Expenses</Text>
                    <Text style={[det.finVal, { color: '#ff7675' }]}>− {fmtMoney(te)}</Text>
                  </View>
                  {booking.expenses.map(e => (
                    <View key={e.id} style={[det.finRow, { paddingLeft: 14 }]}>
                      <Text style={[det.finLabel, { color: 'rgba(255,255,255,0.35)', fontSize: 12 }]}>· {e.title}</Text>
                      <Text style={[det.finVal, { color: 'rgba(255,255,255,0.5)', fontSize: 12 }]}>{fmtMoney(e.amount)}</Text>
                    </View>
                  ))}
                </>
              )}
              <View style={det.finDivider} />
              <View style={[det.finRow, det.finRowTotal]}>
                <Text style={det.finTotalLabel}>Net Profit</Text>
                <Text style={[det.finTotalVal, { color: net >= 0 ? '#2ecc71' : '#ff7675' }]}>{fmtMoney(net)}</Text>
              </View>
              {(te > 0 || acCost > 0) && (
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6, textAlign: 'center' }}>
                  Revenue − AC internal cost − Other expenses
                </Text>
              )}
            </View>

            <TouchableOpacity style={det.closeBtn} onPress={onClose}>
              <Text style={det.closeTxt}>Close</Text>
            </TouchableOpacity>
            <View style={{ height: 32 }} />
          </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    {/* ── Decor Picker Modal ── */}
    <Modal visible={showDecorPicker} transparent animationType="slide" onRequestClose={() => setShowDecorPicker(false)}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: '#00000060' }} activeOpacity={1} onPress={() => setShowDecorPicker(false)}>
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '78%', padding: 16 }}
          onStartShouldSetResponder={() => true}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 }}>Select a Decor</Text>
          <Text style={{ fontSize: 12, color: '#9B98C0', marginBottom: 12 }}>Only decors not linked to another booking are shown</Text>
          <TextInput
            style={{ backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', padding: 10, marginBottom: 10, fontSize: 14, color: '#1A1A2E' }}
            placeholder="Search event, customer, mobile…" placeholderTextColor="#9B98C0"
            value={decorPickerSearch} onChangeText={setDecorPickerSearch} autoFocus
          />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {(() => {
              const available = allDecors.filter(d => !d.bookingId || d.bookingId === booking.id);
              const filtered  = available.filter(d => {
                const q = decorPickerSearch.toLowerCase();
                if (!q) return true;
                return d.eventName.toLowerCase().includes(q) ||
                  d.customerName.toLowerCase().includes(q) ||
                  d.mobile.includes(q);
              });
              if (available.length === 0) {
                return <Text style={{ color: '#9B98C0', textAlign: 'center', padding: 24 }}>No decors available to link</Text>;
              }
              if (filtered.length === 0) {
                return <Text style={{ color: '#9B98C0', textAlign: 'center', padding: 24 }}>No results for "{decorPickerSearch}"</Text>;
              }
              return filtered.map(d => {
                const isLinked = linkedDecors.some(ld => ld._id === d._id);
                const decorTotal = d.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
                const statusColor = d.paymentStatus === 'completed' ? '#27ae60' : d.paymentStatus === 'partial' ? '#f39c12' : '#e74c3c';
                const statusBg   = d.paymentStatus === 'completed' ? '#27ae6020' : d.paymentStatus === 'partial' ? '#f39c1220' : '#e74c3c20';
                return (
                  <TouchableOpacity
                    key={d._id}
                    style={{ padding: 12, borderRadius: 10, marginBottom: 8, backgroundColor: isLinked ? '#8e44ad08' : '#f8f9ff', borderWidth: 1, borderColor: isLinked ? '#8e44ad40' : '#e8eaf0' }}
                    onPress={() => { if (!isLinked) { linkDecor(d); setShowDecorPicker(false); } }}
                    disabled={isLinked}
                    activeOpacity={isLinked ? 1 : 0.75}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A2E', flex: 1, marginRight: 8 }}>{d.eventName}</Text>
                      <View style={{ backgroundColor: statusBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor, textTransform: 'capitalize' }}>{d.paymentStatus}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{d.customerName}  ·  {d.mobile}</Text>
                    {!!d.eventDate && <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{d.eventDate}  {d.eventType ? `· ${d.eventType}` : ''}</Text>}
                    {decorTotal > 0 && <Text style={{ fontSize: 12, color: '#8e44ad', marginTop: 3, fontWeight: '600' }}>Total: {fmtMoney(decorTotal)}</Text>}
                    {isLinked && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <Text style={{ fontSize: 11, color: '#8e44ad', fontWeight: '700' }}>✓ Already linked to this booking</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              });
            })()}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>

    {/* ── Decor Detail / Edit Sheet ── */}
    {activeDecor && (
      <DecorDetailSheet
        decor={activeDecor.decor}
        initialMode={activeDecor.mode}
        onClose={() => setActiveDecor(null)}
        onSaved={handleDecorSaved}
      />
    )}
    </>
  );
}

// ── Add Booking Modal ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  client: '', phone: '', eventName: '',
  venue: VENUE_OPTIONS[0],
  date: '',
  slot: 'morning' as Slot,
  guestCount: '', amount: '',
  status: 'pending' as BookingStatus,
};

function AddBookingModal({ onClose, onSave }: { onClose: () => void; onSave: (b: Omit<Booking, 'id'>) => Promise<void> }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [payMode, setPayMode]     = useState<PaymentMode>('Cash');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate]     = useState(nowDate());
  const [payTime, setPayTime]     = useState(nowTime());
  const [saving, setSaving]       = useState(false);

  function set(key: keyof typeof EMPTY_FORM, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    if (!form.client.trim())    return Alert.alert('Required', 'Please enter client name.');
    if (!form.phone.trim())     return Alert.alert('Required', 'Please enter phone number.');
    if (!form.eventName.trim()) return Alert.alert('Required', 'Please enter event name.');
    if (!isValidDate(form.date)) return Alert.alert('Invalid Date', 'Enter date as YYYY-MM-DD.');
    if (!form.guestCount || isNaN(Number(form.guestCount))) return Alert.alert('Required', 'Enter a valid guest count.');
    if (!form.amount || isNaN(Number(form.amount))) return Alert.alert('Required', 'Enter a valid total cost.');
    if (payAmount && isNaN(Number(payAmount))) return Alert.alert('Invalid', 'Enter a valid advance amount.');

    const payments: Payment[] = payAmount && Number(payAmount) > 0 ? [{
      id: '',
      amount: Number(payAmount),
      mode: payMode,
      date: payDate,
      time: payTime,
    }] : [];

    setSaving(true);
    try {
      await onSave({
        client: form.client.trim(),
        phone: form.phone.trim(),
        eventName: form.eventName.trim(),
        venue: form.venue,
        date: form.date,
        slot: form.slot,
        guestCount: Number(form.guestCount),
        amount: Number(form.amount),
        payments,
        status: form.status,
        extraBenefits: [],
        expenses: [],
      });
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={det.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <View style={form_s.sheet}>
          <View style={modal.handle} />
          <Text style={form_s.title}>New Booking</Text>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <Text style={form_s.label}>Venue</Text>
            <View style={form_s.toggle}>
              {VENUE_OPTIONS.map(v => (
                <TouchableOpacity key={v} style={[form_s.toggleBtn, form.venue === v && form_s.toggleBtnActive]} onPress={() => set('venue', v)}>
                  <Text style={[form_s.toggleTxt, form.venue === v && form_s.toggleTxtActive]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={form_s.label}>Client Name *</Text>
            <TextInput style={form_s.input} placeholder="e.g. Ravi & Priya" value={form.client} onChangeText={v => set('client', v)} />

            <Text style={form_s.label}>Phone Number *</Text>
            <TextInput style={form_s.input} placeholder="10-digit mobile" keyboardType="phone-pad" value={form.phone} onChangeText={v => set('phone', v)} maxLength={10} />

            <Text style={form_s.label}>Event Name *</Text>
            <TextInput style={form_s.input} placeholder="e.g. Wedding, Birthday" value={form.eventName} onChangeText={v => set('eventName', v)} />

            <Text style={form_s.label}>Event Date *</Text>
            <DatePickerField value={form.date} onChange={v => set('date', v)} />

            <Text style={form_s.label}>Slot</Text>
            <View style={form_s.toggle}>
              {(['morning', 'evening'] as Slot[]).map(s => (
                <TouchableOpacity key={s} style={[form_s.toggleBtn, form.slot === s && form_s.toggleBtnActive]} onPress={() => setForm(f => ({ ...f, slot: s }))}>
                  <Text style={[form_s.toggleTxt, form.slot === s && form_s.toggleTxtActive]}>{s === 'morning' ? '🌅 Morning' : '🌆 Evening'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={form_s.label}>Guest Count *</Text>
            <TextInput style={form_s.input} placeholder="e.g. 500" keyboardType="number-pad" value={form.guestCount} onChangeText={v => set('guestCount', v)} />

            <Text style={form_s.label}>Total Cost (₹) *</Text>
            <TextInput style={form_s.input} placeholder="e.g. 150000" keyboardType="number-pad" value={form.amount} onChangeText={v => set('amount', v)} />

            <Text style={form_s.label}>Initial Advance Payment (optional)</Text>
            <View style={pay_s.modeRow}>
              {PAYMENT_MODES.map(m => (
                <TouchableOpacity key={m} style={[pay_s.modeChip, payMode === m && pay_s.modeChipActive]} onPress={() => setPayMode(m)}>
                  <Text style={[pay_s.modeTxt, payMode === m && pay_s.modeTxtActive]}>{MODE_ICON[m]} {m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={form_s.input} placeholder="Amount (leave blank if none)" keyboardType="number-pad" value={payAmount} onChangeText={setPayAmount} />
            <View style={pay_s.dtRow}>
              <DatePickerField value={payDate} onChange={setPayDate} style={{ flex: 1 }} />
              <TextInput style={[form_s.input, { flex: 1, marginLeft: 8 }]} placeholder="HH:MM" keyboardType="numbers-and-punctuation" value={payTime} onChangeText={setPayTime} maxLength={5} />
            </View>

            <Text style={form_s.label}>Status</Text>
            <View style={form_s.toggle}>
              {(['pending', 'confirmed'] as BookingStatus[]).map(s => (
                <TouchableOpacity key={s} style={[form_s.toggleBtn, form.status === s && form_s.toggleBtnActive]} onPress={() => setForm(f => ({ ...f, status: s }))}>
                  <Text style={[form_s.toggleTxt, form.status === s && form_s.toggleTxtActive]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={form_s.actions}>
              <TouchableOpacity style={form_s.cancelBtn} onPress={onClose} disabled={saving}><Text style={form_s.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={form_s.saveBtn} onPress={handleSave} disabled={saving}><Text style={form_s.saveTxt}>{saving ? 'Saving…' : 'Save Booking'}</Text></TouchableOpacity>
            </View>
            <View style={{ height: 32 }} />
          </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function BookingsScreen() {
  const today = new Date();
  const [bookings, setBookings]         = useState<Booking[]>([]);
  const [loading, setLoading]           = useState(true);
  const [year, setYear]                 = useState(today.getFullYear());
  const [month, setMonth]               = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('All Venues');
  const [selectedStatus, setSelectedStatus] = useState<BookingStatus | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadBookings = useCallback(async () => {
    try {
      const data = await bookingsApi.getAll();
      setBookings(data.map(normalizeBooking));
    } catch (e: any) {
      Alert.alert('Error', 'Could not load bookings: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  }

  async function handleAddBooking(b: Omit<Booking, 'id'>) {
    const payload = toBookingPayload({ ...b, id: '' });
    const data = await bookingsApi.create(payload as any);
    setBookings(prev => [...prev, normalizeBooking(data)]);
  }

  async function handleUpdateBooking(updated: Booking): Promise<void> {
    const data = await bookingsApi.update(updated.id, toBookingPayload(updated));
    const normalized = normalizeBooking(data);
    setBookings(prev => prev.map(b => b.id === updated.id ? normalized : b));
    setSelectedBooking(prev => prev?.id === updated.id ? normalized : prev);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EEF0FF' }}>
        <Text style={{ fontSize: 15, color: '#9B98C0' }}>Loading bookings…</Text>
      </View>
    );
  }

  const calendarBookings = bookings.filter(b => {
    const d = new Date(b.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const filtered = bookings.filter(b => {
    const venueOk  = selectedVenue === 'All Venues' || b.venue === selectedVenue;
    const dateOk   = !selectedDate || b.date === selectedDate;
    const statusOk = !selectedStatus || b.status === selectedStatus;
    return venueOk && dateOk && statusOk;
  });

  const totalRevenue  = filtered.reduce((s, b) => s + totalCost(b), 0);
  const totalAdvance  = filtered.reduce((s, b) => s + totalAdvancePaid(b), 0);
  const countPending   = filtered.filter(b => b.status === 'pending').length;
  const countConfirmed = filtered.filter(b => b.status === 'confirmed').length;
  const countCancelled = filtered.filter(b => b.status === 'cancelled').length;

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <Calendar
          year={year} month={month} bookings={calendarBookings}
          selectedDate={selectedDate} onSelectDate={setSelectedDate}
          onPrev={prevMonth} onNext={nextMonth}
        />

        {/* Venue chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
          {VENUES.map(v => (
            <TouchableOpacity key={v} style={[styles.chip, selectedVenue === v && styles.chipActive]} onPress={() => setSelectedVenue(v)}>
              <Text style={[styles.chipText, selectedVenue === v && styles.chipTextActive]}>{v}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{filtered.length}</Text>
            <Text style={styles.summaryLabel}>Bookings</Text>
          </View>
          <View style={styles.summaryDiv} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{fmtMoney(totalRevenue)}</Text>
            <Text style={styles.summaryLabel}>Total Revenue</Text>
          </View>
          <View style={styles.summaryDiv} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{fmtMoney(totalAdvance)}</Text>
            <Text style={styles.summaryLabel}>Advance</Text>
          </View>
        </View>

        {/* Status filter chips */}
        <View style={styles.statusRow}>
          {([
            ['confirmed', countConfirmed, '#27ae60'],
            ['pending',   countPending,   '#f39c12'],
            ['cancelled', countCancelled, '#e74c3c'],
          ] as [BookingStatus, number, string][]).map(([status, count, color]) => {
            const active = selectedStatus === status;
            return (
              <TouchableOpacity
                key={status}
                style={[styles.statusChip, { backgroundColor: active ? color : color + '18', borderColor: active ? color : color + '40' }]}
                onPress={() => setSelectedStatus(active ? null : status)}
                activeOpacity={0.75}
              >
                <Text style={[styles.statusChipNum, { color: active ? '#fff' : color }]}>{count}</Text>
                <Text style={[styles.statusChipLabel, { color: active ? '#fff' : color }]}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Section header */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>
            {selectedDate ? 'Bookings on ' + selectedDate : 'All Bookings'}
          </Text>
          {selectedDate ? (
            <TouchableOpacity onPress={() => setSelectedDate(null)}>
              <Text style={styles.clearBtn}>Clear ✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {filtered.length === 0 ? (
          <Text style={styles.empty}>
            {bookings.length === 0 ? 'No bookings yet. Tap + to add one.' : 'No bookings match the selected filters.'}
          </Text>
        ) : (
          filtered.map(b => (
            <BookingCard key={b.id} booking={b} onPress={() => setSelectedBooking(b)} />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)} activeOpacity={0.85}>
        <Text style={styles.fabIcon}>＋</Text>
      </TouchableOpacity>

      {selectedBooking ? (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onUpdate={handleUpdateBooking}
        />
      ) : null}

      {showAddModal ? (
        <AddBookingModal onClose={() => setShowAddModal(false)} onSave={handleAddBooking} />
      ) : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#EEF0FF' },
  filterRow:      { marginTop: 4 },
  filterContent:  { paddingHorizontal: 16, gap: 8, paddingVertical: 10 },
  chip:           { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' },
  chipActive:     { backgroundColor: '#7B61FF', borderColor: '#7B61FF' },
  chipText:       { fontSize: 13, color: '#6E6E8D', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  summary:        { flexDirection: 'row', backgroundColor: '#7B61FF', marginHorizontal: 16, marginBottom: 16, borderRadius: 18, padding: 18, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 },
  summaryItem:    { flex: 1, alignItems: 'center' },
  summaryNum:     { fontSize: 14, fontWeight: '800', color: '#fff' },
  summaryLabel:   { fontSize: 10, color: 'rgba(255,255,255,0.72)', marginTop: 3, fontWeight: '500' },
  summaryDiv:     { width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  statusRow:      { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  statusChip:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  statusChipNum:  { fontSize: 21, fontWeight: '800' },
  statusChipLabel:{ fontSize: 10, fontWeight: '700', marginTop: 3, letterSpacing: 0.2 },
  sectionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  sectionTitle:   { fontSize: 16, fontWeight: '700', color: '#1A1A2E', letterSpacing: -0.2 },
  clearBtn:       { fontSize: 13, color: '#7B61FF', fontWeight: '600' },
  empty:          { textAlign: 'center', color: '#9B98C0', marginTop: 48, fontSize: 15, fontWeight: '500' },
  fab:            { position: 'absolute', bottom: 28, right: 24, width: 60, height: 60, borderRadius: 30, backgroundColor: '#7B61FF', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 12 },
  fabIcon:        { fontSize: 30, color: '#fff', lineHeight: 34 },
});

const cal = StyleSheet.create({
  container:      { backgroundColor: '#FFFFFF', margin: 16, borderRadius: 20, padding: 18, elevation: 2, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 10 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn:         { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(123,97,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  navText:        { fontSize: 18, color: '#7B61FF', fontWeight: '700' },
  monthTitle:     { fontSize: 17, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.2 },
  row:            { flexDirection: 'row' },
  dayName:        { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#9B98C0', paddingVertical: 5 },
  cell:           { flex: 1, alignItems: 'center', paddingVertical: 5, minHeight: 46 },
  selectedCell:   { backgroundColor: '#7B61FF', borderRadius: 12 },
  todayCell:      { backgroundColor: 'rgba(123,97,255,0.1)', borderRadius: 12 },
  dayNum:         { fontSize: 13, color: '#1A1A2E', fontWeight: '500' },
  selectedDayNum: { color: '#fff', fontWeight: '700' },
  todayDayNum:    { color: '#7B61FF', fontWeight: '800' },
  dots:           { flexDirection: 'row', gap: 3, marginTop: 2 },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  morningDot:     { backgroundColor: '#3B82F6' },
  eveningDot:     { backgroundColor: '#7C3AED' },
  legend:         { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 12 },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText:     { fontSize: 11, color: '#6E6E8D', fontWeight: '500' },
});

const card = StyleSheet.create({
  container: { backgroundColor: '#FFFFFF', marginHorizontal: 16, marginBottom: 12, borderRadius: 18, padding: 18, elevation: 2, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 10 },
  topRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  venue:     { fontSize: 16, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.2 },
  eventName: { fontSize: 13, color: '#7B61FF', fontWeight: '600', marginTop: 2 },
  client:    { fontSize: 12, color: '#9B98C0', marginTop: 2, fontWeight: '500' },
  badge:     { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 22 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  metaRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  meta:      { fontSize: 13, color: '#6E6E8D', fontWeight: '500' },
  slotBadge: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 22 },
  slotText:  { fontSize: 12, fontWeight: '600' },
  elecTag:   { fontSize: 11, color: '#D97706', marginBottom: 4, fontWeight: '600' },
  acTag:     { fontSize: 11, color: '#2563EB', marginBottom: 4, fontWeight: '600' },
  decorTag:   { fontSize: 11, color: '#7C3AED', marginBottom: 4, fontWeight: '600' },
  benefitTag: { fontSize: 11, color: '#10B981', marginBottom: 8, fontWeight: '600' },
  finance:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginTop: 6 },
  finItem:   { alignItems: 'center' },
  finLabel:  { fontSize: 11, color: '#9B98C0', marginBottom: 3, fontWeight: '500' },
  finValue:  { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  barBg:     { height: 5, backgroundColor: 'rgba(123,97,255,0.1)', borderRadius: 3, marginBottom: 4 },
  barFill:   { height: 5, backgroundColor: '#10B981', borderRadius: 3 },
  barLabel:  { fontSize: 11, color: '#9B98C0', textAlign: 'right' },
});

const modal = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  handle:    { width: 44, height: 4, backgroundColor: 'rgba(123,97,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 22 },
});

// Detail modal styles
const det = StyleSheet.create({
  overlay:        { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:          { backgroundColor: '#EEF0FF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: SHEET_MAX_H },
  handle:         { width: 44, height: 4, backgroundColor: 'rgba(123,97,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 18 },

  titleRow:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  title:          { fontSize: 21, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.3 },
  sub:            { fontSize: 13, color: '#6E6E8D', marginBottom: 3, fontWeight: '500' },

  editBtn:        { backgroundColor: 'rgba(123,97,255,0.1)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(123,97,255,0.25)' },
  editBtnTxt:     { fontSize: 13, color: '#7B61FF', fontWeight: '700' },
  printBtn:       { backgroundColor: '#10B9811A', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: '#10B98140' },
  printBtnTxt:    { fontSize: 13, color: '#10B981', fontWeight: '700' },

  editHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  editCloseBtn:   { padding: 6 },
  editCloseTxt:   { fontSize: 18, color: '#9B98C0' },

  detRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9 },
  detLabel:       { fontSize: 13, color: '#9B98C0', flex: 1, fontWeight: '500' },
  detVal:         { fontSize: 13, color: '#1A1A2E', fontWeight: '600', flex: 2, textAlign: 'right' },

  sectionCard:    { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, marginTop: 16, elevation: 1, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
  sectionTitle:   { fontSize: 15, fontWeight: '800', color: '#1A1A2E', marginBottom: 5, letterSpacing: -0.2 },
  sectionHint:    { fontSize: 11, color: '#9B98C0', marginBottom: 14, fontWeight: '500' },

  statusBadge:    { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 22 },
  statusText:     { fontSize: 12, fontWeight: '700' },

  actionRow:      { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  confirmBtn:     { flex: 1, backgroundColor: '#10B9811A', borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: '#10B981' },
  confirmTxt:     { color: '#10B981', fontWeight: '700', fontSize: 13 },
  cancelBtn:      { flex: 1, backgroundColor: '#EF44441A', borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: '#EF4444' },
  cancelTxt:      { color: '#EF4444', fontWeight: '700', fontSize: 13 },

  finRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  finRowTotal:    { marginTop: 4 },
  finLabel:       { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  finVal:         { fontSize: 13, color: '#fff' },
  divider:        { height: 1, backgroundColor: 'rgba(123,97,255,0.08)', marginVertical: 6 },

  readingRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 8 },
  readingArrow:   { paddingBottom: 10, paddingHorizontal: 4 },
  arrowTxt:       { fontSize: 18, color: '#9B98C0' },
  inputLabel:     { fontSize: 11, color: '#9B98C0', fontWeight: '600', marginBottom: 5 },
  input:          { backgroundColor: '#F7F5FF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#1A1A2E', borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)' },

  calcBox:        { backgroundColor: '#FFF8EC', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#FCD34D' },
  calcText:       { fontSize: 13, color: '#D97706', fontWeight: '600', textAlign: 'center' },

  calcHint:       { backgroundColor: '#F7F5FF', borderRadius: 12, padding: 13, marginTop: 4, marginBottom: 4 },
  calcHintText:   { fontSize: 12, color: '#9B98C0', textAlign: 'center', fontStyle: 'italic' },

  calcCard:       { backgroundColor: '#FFF8EC', borderRadius: 14, padding: 16, marginTop: 10, borderWidth: 1, borderColor: '#FCD34D' },
  calcRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  calcLabel:      { fontSize: 13, color: '#9B98C0', fontWeight: '500' },
  calcValue:      { fontSize: 13, color: '#1A1A2E', fontWeight: '500' },
  calcDivider:    { height: 1, backgroundColor: '#FCD34D', marginVertical: 6 },
  calcTotalRow:   { borderTopWidth: 1, borderTopColor: '#F59E0B', marginTop: 2, paddingTop: 8 },
  calcTotalLabel: { fontSize: 14, fontWeight: '800', color: '#1A1A2E' },
  calcTotalValue: { fontSize: 16, fontWeight: '800', color: '#10B981' },

  savedBadge:     { backgroundColor: '#10B9811A', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#10B98140' },
  savedBadgeText: { fontSize: 12, color: '#10B981', fontWeight: '600', textAlign: 'center' },

  decorHeader:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  decorPageBtn:   { backgroundColor: '#7C3AED1A', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#7C3AED50' },
  decorPageTxt:   { fontSize: 12, color: '#7C3AED', fontWeight: '700' },
  decorCalcCard:  { backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, marginTop: 10, borderWidth: 1, borderColor: '#DDD6FE' },

  finSummaryCard:  { backgroundColor: '#1A1A2E', borderRadius: 18, padding: 22, marginTop: 16 },
  finSummaryTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 16, letterSpacing: -0.2 },
  finDivider:      { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 10 },
  finTotalLabel:   { fontSize: 14, fontWeight: '800', color: '#fff' },
  finTotalVal:     { fontSize: 16, fontWeight: '800', color: '#fff' },
  finSectionLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },

  saveBtn:        { backgroundColor: '#7B61FF', borderRadius: 12, paddingVertical: 12, alignItems: 'center', flex: 1 },
  saveTxt:        { color: '#fff', fontWeight: '700', fontSize: 13 },
  ghostBtn:       { borderRadius: 12, paddingVertical: 12, alignItems: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(123,97,255,0.2)' },
  ghostTxt:       { color: '#9B98C0', fontWeight: '600', fontSize: 13 },

  expList:        { marginBottom: 14 },
  expItem:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(123,97,255,0.08)' },
  expTitle:       { flex: 1, fontSize: 13, color: '#1A1A2E', fontWeight: '500' },
  expAmount:      { fontSize: 13, fontWeight: '700', color: '#EF4444', marginRight: 10 },
  expDel:         { padding: 4 },
  expDelTxt:      { fontSize: 12, color: 'rgba(123,97,255,0.3)' },
  expTotal:       { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 },
  expTotalLabel:  { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  expTotalVal:    { fontSize: 13, fontWeight: '700', color: '#EF4444' },
  expInputRow:    { flexDirection: 'row', gap: 8, marginBottom: 10 },
  emptyHint:      { fontSize: 12, color: '#9B98C0', marginBottom: 14, fontStyle: 'italic' },

  closeBtn:       { backgroundColor: '#1A1A2E', borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  closeTxt:       { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Transaction Summary — charges/payments blocks
  finBlockLabel:  { fontSize: 10, fontWeight: '700', color: '#9B98C0', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
  finBlock:       { backgroundColor: '#F7F5FF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' },
  finBRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6 },
  finBLabel:      { fontSize: 12, color: '#6E6E8D', flex: 1, paddingRight: 8, fontWeight: '500' },
  finBVal:        { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  finBTotalRow:   { borderTopWidth: 1, borderTopColor: 'rgba(123,97,255,0.15)', marginTop: 4, paddingTop: 10 },
  finBTotalLabel: { fontSize: 13, fontWeight: '800', color: '#1A1A2E' },
  finBTotalVal:   { fontSize: 15, fontWeight: '800', color: '#1A1A2E' },

  // Balance status banners
  balanceDueBox:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF1F2', borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: '#FECDD3' },
  balanceDueLabel: { fontSize: 14, fontWeight: '800', color: '#BE123C' },
  balanceDueHint:  { fontSize: 11, color: '#FB7185', marginTop: 2, fontWeight: '500' },
  balanceDueAmt:   { fontSize: 22, fontWeight: '900', color: '#BE123C' },
  fullyPaidBox:    { backgroundColor: '#F0FDF4', borderRadius: 16, padding: 16, marginTop: 16, alignItems: 'center', borderWidth: 1, borderColor: '#BBF7D0' },
  fullyPaidTxt:    { fontSize: 14, fontWeight: '800', color: '#16A34A' },

  // Balance payment input box
  balPayBox:   { backgroundColor: '#F7F5FF', borderRadius: 14, padding: 16, marginTop: 14, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' },
  balPayTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A2E', marginBottom: 12 },
  settleBtn:   { backgroundColor: '#F59E0B', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  settleTxt:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  paidBanner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ECFDF5', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#A7F3D0' },
  paidBannerTxt:  { fontSize: 13, fontWeight: '700', color: '#059669', flex: 1, flexShrink: 1 },
  paidReopenTxt:  { fontSize: 12, color: '#9B98C0', fontWeight: '600', paddingLeft: 12 },

  paidTopBanner:    { backgroundColor: '#059669', borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
  paidTopBannerTxt: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  paidTopSub:       { color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 3 },

  editPayBtn:  { backgroundColor: '#0596691A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#05966940' },
  editPayTxt:  { fontSize: 12, color: '#059669', fontWeight: '700' },

  payLockedNote: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#A7F3D0' },
  payLockedTxt:  { fontSize: 12, color: '#059669', fontWeight: '600', flex: 1 },
});

const pay_s = StyleSheet.create({
  modeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  modeChip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, backgroundColor: '#F7F5FF', borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)' },
  modeChipActive:{ backgroundColor: '#7B61FF', borderColor: '#7B61FF' },
  modeTxt:       { fontSize: 12, color: '#6E6E8D', fontWeight: '600' },
  modeTxtActive: { color: '#fff' },
  dtRow:         { flexDirection: 'row', gap: 8, marginTop: 10 },

  payItem:       { backgroundColor: '#F7F5FF', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' },
  payTopRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  payMode:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payModeText:   { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  payAmount:     { fontSize: 15, fontWeight: '800', color: '#10B981' },
  payMeta:       { fontSize: 11, color: '#9B98C0', fontWeight: '500' },
  payItemEditing:{ borderColor: '#F59E0B', borderWidth: 2, backgroundColor: '#FFFBEB' },
  payEdit:       { padding: 4 },
  payEditTxt:    { fontSize: 13 },
  payDel:        { padding: 4 },
  payDelTxt:     { fontSize: 12, color: 'rgba(123,97,255,0.3)' },
  editBanner:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FCD34D' },
  editBannerTxt: { fontSize: 12, color: '#D97706', fontWeight: '600', flex: 1 },
  editBannerCancel: { fontSize: 12, color: '#EF4444', fontWeight: '700', paddingLeft: 10 },

  totalRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(123,97,255,0.15)' },
  totalLabel:    { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  totalVal:      { fontSize: 14, fontWeight: '800', color: '#10B981' },
});

const form_s = StyleSheet.create({
  sheet:           { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: SHEET_MAX_H },
  title:           { fontSize: 21, fontWeight: '800', color: '#1A1A2E', marginBottom: 22, letterSpacing: -0.3 },
  label:           { fontSize: 11, fontWeight: '700', color: '#9B98C0', marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  input:           { backgroundColor: '#F7F5FF', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, fontSize: 14, color: '#1A1A2E', borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)' },
  toggle:          { flexDirection: 'row', gap: 10 },
  toggleBtn:       { flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: '#F7F5FF', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)' },
  toggleBtnActive: { backgroundColor: '#7B61FF', borderColor: '#7B61FF' },
  toggleTxt:       { fontSize: 13, color: '#6E6E8D', fontWeight: '600' },
  toggleTxtActive: { color: '#fff' },
  actions:         { flexDirection: 'row', gap: 12, marginTop: 26 },
  cancelBtn:       { flex: 1, paddingVertical: 15, borderRadius: 14, backgroundColor: '#F7F5FF', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)' },
  cancelTxt:       { fontSize: 15, color: '#6E6E8D', fontWeight: '600' },
  saveBtn:         { flex: 2, paddingVertical: 15, borderRadius: 14, backgroundColor: '#7B61FF', alignItems: 'center' },
  saveTxt:         { fontSize: 15, color: '#fff', fontWeight: '700' },
});
