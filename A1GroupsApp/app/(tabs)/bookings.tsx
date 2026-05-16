import {
  Alert,
  Dimensions,
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
import { bookingsApi } from '../../lib/api';

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
    backgroundColor: '#f4f6fb', borderRadius: 10, borderWidth: 1,
    borderColor: '#e8eaf0', overflow: 'hidden' as const,
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
            color: value ? '#1a1a2e' : '#aaa', width: '100%',
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
        <Text style={{ fontSize: 14, color: value ? '#1a1a2e' : '#aaa' }}>
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
                  <TouchableOpacity style={[det.saveBtn, { marginTop: 10, backgroundColor: editingPaymentId ? '#f39c12' : '#6C63FF' }]} onPress={addPayment}>
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
                  <Text style={det.sectionTitle}>🎨 Decor Cost</Text>
                  <Text style={det.sectionHint}>Added to customer total</Text>
                </View>
                <TouchableOpacity style={det.decorPageBtn} onPress={() => { onClose(); router.push('/(tabs)/decor' as any); }}>
                  <Text style={det.decorPageTxt}>View Decor Page →</Text>
                </TouchableOpacity>
              </View>

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
                        <Text style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{p.date}  ·  {p.time}</Text>
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f6fb' }}>
        <Text style={{ fontSize: 15, color: '#888' }}>Loading bookings…</Text>
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
  container:      { flex: 1, backgroundColor: '#f4f6fb' },
  filterRow:      { marginTop: 4 },
  filterContent:  { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  chipActive:     { backgroundColor: '#6C63FF', borderColor: '#6C63FF' },
  chipText:       { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  summary:        { flexDirection: 'row', backgroundColor: '#6C63FF', marginHorizontal: 16, marginBottom: 16, borderRadius: 14, padding: 16 },
  summaryItem:    { flex: 1, alignItems: 'center' },
  summaryNum:     { fontSize: 13, fontWeight: 'bold', color: '#fff' },
  summaryLabel:   { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  summaryDiv:     { width: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  statusRow:      { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 14 },
  statusChip:     { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  statusChipNum:  { fontSize: 20, fontWeight: '800' },
  statusChipLabel:{ fontSize: 11, fontWeight: '700', marginTop: 2 },
  sectionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle:   { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  clearBtn:       { fontSize: 13, color: '#6C63FF', fontWeight: '600' },
  empty:          { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 15 },
  fab:            { position: 'absolute', bottom: 24, right: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: '#6C63FF', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
  fabIcon:        { fontSize: 30, color: '#fff', lineHeight: 34 },
});

const cal = StyleSheet.create({
  container:      { backgroundColor: '#fff', margin: 16, borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 6 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn:         { padding: 8 },
  navText:        { fontSize: 22, color: '#6C63FF', fontWeight: 'bold' },
  monthTitle:     { fontSize: 17, fontWeight: '700', color: '#1a1a2e' },
  row:            { flexDirection: 'row' },
  dayName:        { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#999', paddingVertical: 4 },
  cell:           { flex: 1, alignItems: 'center', paddingVertical: 5, minHeight: 44 },
  selectedCell:   { backgroundColor: '#6C63FF', borderRadius: 10 },
  todayCell:      { backgroundColor: '#f0eeff', borderRadius: 10 },
  dayNum:         { fontSize: 13, color: '#333' },
  selectedDayNum: { color: '#fff', fontWeight: '700' },
  todayDayNum:    { color: '#6C63FF', fontWeight: '700' },
  dots:           { flexDirection: 'row', gap: 3, marginTop: 2 },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  morningDot:     { backgroundColor: '#2980b9' },
  eveningDot:     { backgroundColor: '#8e44ad' },
  legend:         { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 10 },
  legendItem:     { flexDirection: 'row', alignItems: 'center' },
  legendText:     { fontSize: 11, color: '#666' },
});

const card = StyleSheet.create({
  container: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 14, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 5 },
  topRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  venue:     { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  eventName: { fontSize: 12, color: '#6C63FF', fontWeight: '600', marginTop: 1 },
  client:    { fontSize: 12, color: '#888', marginTop: 2 },
  badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  metaRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  meta:      { fontSize: 13, color: '#555' },
  slotBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  slotText:  { fontSize: 12, fontWeight: '600' },
  elecTag:   { fontSize: 11, color: '#e67e22', marginBottom: 4, fontWeight: '600' },
  acTag:     { fontSize: 11, color: '#2980b9', marginBottom: 4, fontWeight: '600' },
  decorTag:   { fontSize: 11, color: '#8e44ad', marginBottom: 4, fontWeight: '600' },
  benefitTag: { fontSize: 11, color: '#27ae60', marginBottom: 8, fontWeight: '600' },
  finance:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },
  finItem:   { alignItems: 'center' },
  finLabel:  { fontSize: 11, color: '#999', marginBottom: 2 },
  finValue:  { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
  barBg:     { height: 5, backgroundColor: '#eee', borderRadius: 3, marginBottom: 4 },
  barFill:   { height: 5, backgroundColor: '#27ae60', borderRadius: 3 },
  barLabel:  { fontSize: 11, color: '#999', textAlign: 'right' },
});

const modal = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  handle:    { width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
});

// Detail modal styles
const det = StyleSheet.create({
  overlay:        { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:          { backgroundColor: '#f4f6fb', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: SHEET_MAX_H },
  handle:         { width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },

  titleRow:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  title:          { fontSize: 20, fontWeight: '800', color: '#1a1a2e' },
  sub:            { fontSize: 13, color: '#666', marginBottom: 3 },

  editBtn:        { backgroundColor: '#6C63FF18', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#6C63FF55' },
  editBtnTxt:     { fontSize: 13, color: '#6C63FF', fontWeight: '700' },
  printBtn:       { backgroundColor: '#27ae6018', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#27ae6055' },
  printBtnTxt:    { fontSize: 13, color: '#27ae60', fontWeight: '700' },

  editHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  editCloseBtn:   { padding: 6 },
  editCloseTxt:   { fontSize: 18, color: '#999' },

  detRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  detLabel:       { fontSize: 13, color: '#888', flex: 1 },
  detVal:         { fontSize: 13, color: '#1a1a2e', fontWeight: '600', flex: 2, textAlign: 'right' },

  sectionCard:    { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 14, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4 },
  sectionTitle:   { fontSize: 14, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  sectionHint:    { fontSize: 11, color: '#999', marginBottom: 12 },

  statusBadge:    { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  statusText:     { fontSize: 12, fontWeight: '700' },

  actionRow:      { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  confirmBtn:     { flex: 1, backgroundColor: '#27ae6022', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#27ae60' },
  confirmTxt:     { color: '#27ae60', fontWeight: '700', fontSize: 13 },
  cancelBtn:      { flex: 1, backgroundColor: '#e74c3c18', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#e74c3c' },
  cancelTxt:      { color: '#e74c3c', fontWeight: '700', fontSize: 13 },

  finRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  finRowTotal:    { marginTop: 4 },
  finLabel:       { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  finVal:         { fontSize: 13, color: '#fff' },
  divider:        { height: 1, backgroundColor: '#f0f0f0', marginVertical: 6 },

  readingRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 8 },
  readingArrow:   { paddingBottom: 10, paddingHorizontal: 4 },
  arrowTxt:       { fontSize: 18, color: '#999' },
  inputLabel:     { fontSize: 11, color: '#666', fontWeight: '600', marginBottom: 4 },
  input:          { backgroundColor: '#f4f6fb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1a1a2e', borderWidth: 1, borderColor: '#e8eaf0' },

  calcBox:        { backgroundColor: '#fff8ec', borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#f0c27f' },
  calcText:       { fontSize: 13, color: '#b7770d', fontWeight: '600', textAlign: 'center' },

  calcHint:       { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 4 },
  calcHintText:   { fontSize: 12, color: '#aaa', textAlign: 'center', fontStyle: 'italic' },

  calcCard:       { backgroundColor: '#fff8ec', borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: '#f0c27f' },
  calcRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  calcLabel:      { fontSize: 13, color: '#888' },
  calcValue:      { fontSize: 13, color: '#1a1a2e' },
  calcDivider:    { height: 1, backgroundColor: '#f0c27f', marginVertical: 6 },
  calcTotalRow:   { borderTopWidth: 1, borderTopColor: '#e6b800', marginTop: 2, paddingTop: 8 },
  calcTotalLabel: { fontSize: 14, fontWeight: '800', color: '#1a1a2e' },
  calcTotalValue: { fontSize: 16, fontWeight: '800', color: '#27ae60' },

  savedBadge:     { backgroundColor: '#27ae6015', borderRadius: 8, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#27ae6040' },
  savedBadgeText: { fontSize: 12, color: '#27ae60', fontWeight: '600', textAlign: 'center' },

  decorHeader:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  decorPageBtn:   { backgroundColor: '#8e44ad18', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#8e44ad55' },
  decorPageTxt:   { fontSize: 12, color: '#8e44ad', fontWeight: '700' },
  decorCalcCard:  { backgroundColor: '#f9f0ff', borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: '#d7b8f3' },

  finSummaryCard:  { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, marginTop: 14 },
  finSummaryTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 14 },
  finDivider:      { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 10 },
  finTotalLabel:   { fontSize: 14, fontWeight: '800', color: '#fff' },
  finTotalVal:     { fontSize: 16, fontWeight: '800', color: '#fff' },
  finSectionLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },

  saveBtn:        { backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 11, alignItems: 'center', flex: 1 },
  saveTxt:        { color: '#fff', fontWeight: '700', fontSize: 13 },
  ghostBtn:       { borderRadius: 10, paddingVertical: 11, alignItems: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: '#ddd' },
  ghostTxt:       { color: '#888', fontWeight: '600', fontSize: 13 },

  expList:        { marginBottom: 12 },
  expItem:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f4f4f4' },
  expTitle:       { flex: 1, fontSize: 13, color: '#1a1a2e' },
  expAmount:      { fontSize: 13, fontWeight: '700', color: '#e74c3c', marginRight: 10 },
  expDel:         { padding: 4 },
  expDelTxt:      { fontSize: 12, color: '#ccc' },
  expTotal:       { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 4 },
  expTotalLabel:  { fontSize: 13, fontWeight: '700', color: '#1a1a2e' },
  expTotalVal:    { fontSize: 13, fontWeight: '700', color: '#e74c3c' },
  expInputRow:    { flexDirection: 'row', gap: 8, marginBottom: 8 },
  emptyHint:      { fontSize: 12, color: '#bbb', marginBottom: 12, fontStyle: 'italic' },

  closeBtn:       { backgroundColor: '#1a1a2e', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  closeTxt:       { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Transaction Summary — charges/payments blocks
  finBlockLabel:  { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  finBlock:       { backgroundColor: '#f8f9ff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eef0f8' },
  finBRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5 },
  finBLabel:      { fontSize: 12, color: '#555', flex: 1, paddingRight: 8 },
  finBVal:        { fontSize: 13, fontWeight: '600', color: '#1a1a2e' },
  finBTotalRow:   { borderTopWidth: 1, borderTopColor: '#e0e4f0', marginTop: 4, paddingTop: 8 },
  finBTotalLabel: { fontSize: 13, fontWeight: '800', color: '#1a1a2e' },
  finBTotalVal:   { fontSize: 15, fontWeight: '800', color: '#1a1a2e' },

  // Balance status banners
  balanceDueBox:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff2f2', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: '#ffcdd2' },
  balanceDueLabel: { fontSize: 14, fontWeight: '800', color: '#c0392b' },
  balanceDueHint:  { fontSize: 11, color: '#e07070', marginTop: 2 },
  balanceDueAmt:   { fontSize: 22, fontWeight: '900', color: '#c0392b' },
  fullyPaidBox:    { backgroundColor: '#f0fff4', borderRadius: 12, padding: 14, marginTop: 14, alignItems: 'center', borderWidth: 1, borderColor: '#b7f5c8' },
  fullyPaidTxt:    { fontSize: 14, fontWeight: '800', color: '#27ae60' },

  // Balance payment input box
  balPayBox:   { backgroundColor: '#f8f9ff', borderRadius: 10, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#e0e4f0' },
  balPayTitle: { fontSize: 13, fontWeight: '700', color: '#1a1a2e', marginBottom: 10 },
  settleBtn:   { backgroundColor: '#f39c12', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center' },
  settleTxt:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  paidBanner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#e8fdf5', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#a3e9cf' },
  paidBannerTxt:  { fontSize: 13, fontWeight: '700', color: '#1abc9c', flex: 1, flexShrink: 1 },
  paidReopenTxt:  { fontSize: 12, color: '#999', fontWeight: '600', paddingLeft: 12 },

  paidTopBanner:    { backgroundColor: '#1abc9c', borderRadius: 12, padding: 14, marginBottom: 14, alignItems: 'center' },
  paidTopBannerTxt: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  paidTopSub:       { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 3 },

  editPayBtn:  { backgroundColor: '#1abc9c18', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#1abc9c55' },
  editPayTxt:  { fontSize: 12, color: '#1abc9c', fontWeight: '700' },

  payLockedNote: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8fdf5', borderRadius: 8, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#a3e9cf' },
  payLockedTxt:  { fontSize: 12, color: '#1abc9c', fontWeight: '600', flex: 1 },
});

const pay_s = StyleSheet.create({
  modeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  modeChip:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f4f6fb', borderWidth: 1, borderColor: '#e0e0e0' },
  modeChipActive:{ backgroundColor: '#6C63FF', borderColor: '#6C63FF' },
  modeTxt:       { fontSize: 12, color: '#555', fontWeight: '600' },
  modeTxtActive: { color: '#fff' },
  dtRow:         { flexDirection: 'row', gap: 8, marginTop: 8 },

  payItem:       { backgroundColor: '#f8f9ff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e8eaf0' },
  payTopRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  payMode:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payModeText:   { fontSize: 13, fontWeight: '700', color: '#1a1a2e' },
  payAmount:     { fontSize: 15, fontWeight: '800', color: '#27ae60' },
  payMeta:       { fontSize: 11, color: '#999' },
  payItemEditing:{ borderColor: '#f39c12', borderWidth: 2, backgroundColor: '#fffbf0' },
  payEdit:       { padding: 4 },
  payEditTxt:    { fontSize: 13 },
  payDel:        { padding: 4 },
  payDelTxt:     { fontSize: 12, color: '#ddd' },
  editBanner:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff8ec', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#f0c27f' },
  editBannerTxt: { fontSize: 12, color: '#b7770d', fontWeight: '600', flex: 1 },
  editBannerCancel: { fontSize: 12, color: '#e74c3c', fontWeight: '700', paddingLeft: 10 },

  totalRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: '#e8eaf0' },
  totalLabel:    { fontSize: 13, fontWeight: '700', color: '#1a1a2e' },
  totalVal:      { fontSize: 14, fontWeight: '800', color: '#27ae60' },
});

const form_s = StyleSheet.create({
  sheet:           { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: SHEET_MAX_H },
  title:           { fontSize: 20, fontWeight: '800', color: '#1a1a2e', marginBottom: 20 },
  label:           { fontSize: 12, fontWeight: '600', color: '#666', marginTop: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:           { backgroundColor: '#f4f6fb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#1a1a2e', borderWidth: 1, borderColor: '#e8eaf0' },
  toggle:          { flexDirection: 'row', gap: 10 },
  toggleBtn:       { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f4f6fb', alignItems: 'center', borderWidth: 1, borderColor: '#e8eaf0' },
  toggleBtnActive: { backgroundColor: '#6C63FF', borderColor: '#6C63FF' },
  toggleTxt:       { fontSize: 13, color: '#555', fontWeight: '600' },
  toggleTxtActive: { color: '#fff' },
  actions:         { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn:       { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#f4f6fb', alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  cancelTxt:       { fontSize: 15, color: '#555', fontWeight: '600' },
  saveBtn:         { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#6C63FF', alignItems: 'center' },
  saveTxt:         { fontSize: 15, color: '#fff', fontWeight: '700' },
});
