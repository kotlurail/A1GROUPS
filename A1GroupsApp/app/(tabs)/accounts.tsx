import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  StyleSheet, Platform, Alert, Dimensions, KeyboardAvoidingView, StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { transactionsApi, accountsApi, bookingsApi, FeedItem, BookingDoc } from '../../lib/api';

const W = Dimensions.get('window').width;
const SHEET_MAX_H = Dimensions.get('window').height * 0.88;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const TODAY = todayStr();

function last6Months(): { ym: string; label: string }[] {
  const ML = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { ym: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: ML[d.getMonth()] };
  });
}

function last12Months(): { ym: string; label: string }[] {
  const ML = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { ym: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${ML[d.getMonth()]} ${d.getFullYear()}` };
  });
}

function monthPickerList(): { ym: string; label: string; ref: string }[] {
  const ML = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  return Array.from({ length: 24 }, (_, i) => {
    const d  = new Date(now.getFullYear(), now.getMonth() - (23 - i), 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return { ym, label: `${ML[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, ref: `${ym}-01` };
  });
}

function yearPickerList(): { year: number; ref: string }[] {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const y = now.getFullYear() - (4 - i);
    return { year: y, ref: `${y}-01-01` };
  });
}

// Use event date for grouping/filtering; fall back to transaction date
const evDate = (item: { eventDate?: string; date: string }) => item.eventDate || item.date;

// ─── Types ────────────────────────────────────────────────────────────────────
type TxType   = 'income' | 'expense';
type TxStatus = 'completed' | 'pending' | 'cancelled';
type Period   = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly' | 'All Time';
type TxFilter = 'All' | 'Income' | 'Expense';
type SortKey  = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'venue-az' | 'category-az' | 'type-income' | 'type-expense' | 'status';

interface Transaction {
  id: string;
  type: TxType;
  venue: string;
  category: string;
  amount: number;
  paymentMethod: string;
  date: string;
  comments: string;
  status: TxStatus;
}

interface TxForm {
  type: TxType; venue: string; category: string; amount: string;
  paymentMethod: string; date: string; comments: string; status: TxStatus;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const VENUES          = ['A1 Function Hall', 'A1 Grand', 'A1 Events & Decors','Family','Others','Credit'];
const INCOME_TYPES    = ['Hall Booking', 'Decoration Booking', 'Advance Payment', 'Full Payment', 'Catering Income', 'Other Income'];
const EXPENSE_TYPES   = ['Monthly Rent', 'Current Bill', 'Salaries', 'Daily Expenses', 'Investments', 'Maintenance', 'Decoration Expenses', 'Marketing', 'Fuel Charges', 'Other Expenses','Medicines','Food','Travel'];
const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'];
const PERIODS: Period[]   = ['Daily', 'Weekly', 'Monthly', 'Yearly', 'All Time'];
const STATUS_OPTIONS  = ['completed', 'pending', 'cancelled'];
const SORT_OPTIONS: { key: SortKey; label: string; icon: string; group: string }[] = [
  { key: 'date-desc',      label: 'Newest First',     icon: '🕐', group: 'Date'     },
  { key: 'date-asc',       label: 'Oldest First',     icon: '🕰', group: 'Date'     },
  { key: 'amount-desc',    label: 'Highest Amount',   icon: '💰', group: 'Amount'   },
  { key: 'amount-asc',     label: 'Lowest Amount',    icon: '💸', group: 'Amount'   },
  { key: 'venue-az',       label: 'Venue (A–Z)',       icon: '🏛', group: 'Venue'    },
  { key: 'category-az',    label: 'Category (A–Z)',    icon: '🗂', group: 'Category' },
  { key: 'type-income',    label: 'Income First',     icon: '📈', group: 'Type'     },
  { key: 'type-expense',   label: 'Expense First',    icon: '📉', group: 'Type'     },
  { key: 'status',         label: 'By Status',        icon: '🔖', group: 'Status'   },
];


// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');

function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function isInPeriod(date: string, period: Period, ref: string): boolean {
  if (period === 'All Time') return true;
  const d = parseDate(date), r = parseDate(ref);
  if (period === 'Daily') return d.toDateString() === r.toDateString();
  if (period === 'Weekly') {
    const diff = (r.getTime() - d.getTime()) / 86400000;
    return diff >= 0 && diff < 7;
  }
  if (period === 'Monthly') return d.getFullYear() === r.getFullYear() && d.getMonth() === r.getMonth();
  if (period === 'Yearly')  return d.getFullYear() === r.getFullYear();
  return true;
}

const emptyForm = (): TxForm => ({
  type: 'income', venue: VENUES[0], category: INCOME_TYPES[0],
  amount: '', paymentMethod: PAYMENT_METHODS[0], date: todayStr(), comments: '', status: 'completed',
});

// ─── Theme ────────────────────────────────────────────────────────────────────
const light = { bg: '#EEF0FF', card: '#FFFFFF', text: '#1A1A2E', sub: '#6E6E8D', border: 'rgba(123,97,255,0.12)', input: '#F7F5FF' };
const dark  = { bg: '#12102B', card: '#1E1B3A', text: '#F0EDFF', sub: '#9B98C0', border: 'rgba(123,97,255,0.2)',  input: '#12102B' };

// ─── SelectField ──────────────────────────────────────────────────────────────
function SelectField({ label, value, options, onChange, isDark }: {
  label?: string; value: string; options: string[]; onChange: (v: string) => void; isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const t = isDark ? dark : light;
  const fil = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      {label && <Text style={[s.fieldLabel, { color: t.sub }]}>{label}</Text>}
      <TouchableOpacity
        style={[s.selectTrigger, { backgroundColor: t.card, borderColor: t.border }]}
        onPress={() => { setSearch(''); setOpen(true); }}
      >
        <Text style={{ color: value ? t.text : t.sub, flex: 1 }}>{value || 'Select...'}</Text>
        <Text style={{ color: t.sub }}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[s.selectPanel, { backgroundColor: t.card, borderColor: t.border }]} onStartShouldSetResponder={() => true}>
            <TextInput
              style={[s.selectSearch, { backgroundColor: t.bg, color: t.text, borderColor: t.border }]}
              placeholder="Search..." placeholderTextColor={t.sub}
              value={search} onChangeText={setSearch} autoFocus
            />
            <ScrollView style={{ maxHeight: 220 }}>
              {fil.map(o => (
                <TouchableOpacity key={o} style={s.selectOpt} onPress={() => { onChange(o); setOpen(false); }}>
                  <Text style={{ color: value === o ? '#6C63FF' : t.text, fontWeight: value === o ? '700' : '400' }}>{o}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── DateField ────────────────────────────────────────────────────────────────
function DateField({ label, value, onChange, isDark }: { label: string; value: string; onChange: (v: string) => void; isDark: boolean }) {
  const t = isDark ? dark : light;
  if (Platform.OS === 'web') {
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={[s.fieldLabel, { color: t.sub }]}>{label}</Text>
        <input type="date" value={value} onChange={e => onChange((e.target as HTMLInputElement).value)}
          style={{ padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, backgroundColor: t.card, color: t.text, width: '100%', fontSize: 14 }} />
      </View>
    );
  }
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[s.fieldLabel, { color: t.sub }]}>{label}</Text>
      <TextInput
        style={[s.selectTrigger, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
        value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={t.sub}
      />
    </View>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 26, gap: 2, marginTop: 4 }}>
      {data.map((v, i) => (
        <View key={i} style={{ width: 5, height: Math.max(2, (v / max) * 26), backgroundColor: color, borderRadius: 2, opacity: 0.5 + 0.5 * (i / data.length) }} />
      ))}
    </View>
  );
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────
function SummaryCard({ title, amount, trend, trendUp, color, spark, isDark }: {
  title: string; amount: number; trend: string; trendUp: boolean; color: string; spark: number[]; isDark: boolean;
}) {
  const t = isDark ? dark : light;
  const icons: Record<string, string> = {
    'Revenue Collected': '💵',
    'Total Costs':       '💸',
    'Net Earned':        '💹',
    'This Month':        '📅',
    'This Year':         '🗓️',
    'To Collect':        '⏳',
  };
  return (
    <View style={[s.summaryCard, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={[s.summaryIcon, { backgroundColor: color + '20' }]}>
        <Text style={{ fontSize: 16 }}>{icons[title] ?? '💳'}</Text>
      </View>
      <Text style={[s.summaryTitle, { color: t.sub }]}>{title}</Text>
      <Text style={[s.summaryAmt, { color }]}>{fmt(amount)}</Text>
      <Text style={{ color: trendUp ? '#27ae60' : '#e74c3c', fontSize: 11, marginTop: 1 }}>
        {trendUp ? '▲' : '▼'} {trend}
      </Text>
      <Sparkline data={spark} color={color} />
    </View>
  );
}

// ─── HBar ─────────────────────────────────────────────────────────────────────
function HBar({ label, value, max, color, isDark }: { label: string; value: number; max: number; color: string; isDark: boolean }) {
  const t = isDark ? dark : light;
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: t.text, fontSize: 12 }} numberOfLines={1}>{label}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{fmt(value)}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: t.border, borderRadius: 3 }}>
        <View style={{ height: 6, width: `${pct}%` as any, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

// ─── TxRow ────────────────────────────────────────────────────────────────────
function TxRow({ tx, onView, onEdit, onDelete, onPrint, isDark }: {
  tx: Transaction; onView(): void; onEdit(): void; onDelete(): void; onPrint(): void; isDark: boolean;
}) {
  const t = isDark ? dark : light;
  const inc = tx.type === 'income';
  const sc: Record<TxStatus, string> = { completed: '#27ae60', pending: '#f39c12', cancelled: '#e74c3c' };
  return (
    <View style={[s.txRow, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <View style={[s.txBadge, { backgroundColor: inc ? '#27ae6020' : '#e74c3c20' }]}>
          <Text style={{ color: inc ? '#27ae60' : '#e74c3c', fontSize: 10, fontWeight: '700' }}>{inc ? '+INC' : '-EXP'}</Text>
        </View>
        <Text style={[s.txCat, { color: t.text }]}>{tx.category}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ color: inc ? '#27ae60' : '#e74c3c', fontSize: 14, fontWeight: '800' }}>
          {inc ? '+' : '-'}{fmt(tx.amount)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 2 }}>
        <Text style={{ color: t.sub, fontSize: 11 }}>{tx.venue}</Text>
        <Text style={{ color: t.border }}> • </Text>
        <Text style={{ color: t.sub, fontSize: 11 }}>{tx.date}</Text>
        <Text style={{ color: t.border }}> • </Text>
        <Text style={{ color: t.sub, fontSize: 11 }}>{tx.paymentMethod}</Text>
        <View style={{ flex: 1 }} />
        <View style={[s.txStatus, { backgroundColor: sc[tx.status] + '20' }]}>
          <Text style={{ color: sc[tx.status], fontSize: 10, fontWeight: '600' }}>
            {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
          </Text>
        </View>
      </View>
      {!!tx.comments && <Text style={{ color: t.sub, fontSize: 11, marginBottom: 6 }} numberOfLines={1}>{tx.comments}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['👁', '✏️', '🗑', '🖨'] as const).map((icon, i) => {
          const fns = [onView, onEdit, onDelete, onPrint];
          const clrs = ['#3498db', '#f39c12', '#e74c3c', '#8e44ad'];
          return (
            <TouchableOpacity key={i} style={[s.txBtn, { borderColor: clrs[i] + '50' }]} onPress={fns[i]}>
              <Text style={{ color: clrs[i], fontSize: 13 }}>{icon}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── TxModal ──────────────────────────────────────────────────────────────────
function TxModal({ visible, form, setForm, onSave, onClose, isDark, isEdit }: {
  visible: boolean; form: TxForm; setForm(f: TxForm): void; onSave(): void; onClose(): void; isDark: boolean; isEdit: boolean;
}) {
  const t = isDark ? dark : light;
  const insets = useSafeAreaInsets();
  const cats = form.type === 'income' ? INCOME_TYPES : EXPENSE_TYPES;
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%', position: 'absolute', bottom: 0 }}>
          <View style={[s.sheet, { backgroundColor: t.bg, height: SHEET_MAX_H, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Text style={[s.sheetTitle, { color: t.text }]}>{isEdit ? 'Edit Transaction' : 'Add Transaction'}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={onClose}><Text style={{ color: t.sub, fontSize: 22 }}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[s.fieldLabel, { color: t.sub }]}>Type</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {(['income', 'expense'] as TxType[]).map(tp => {
                  const active = form.type === tp;
                  const col = tp === 'income' ? '#27ae60' : '#e74c3c';
                  return (
                    <TouchableOpacity key={tp} style={[s.typeBtn, { backgroundColor: active ? col : t.card, borderColor: col }]}
                      onPress={() => setForm({ ...form, type: tp, category: tp === 'income' ? INCOME_TYPES[0] : EXPENSE_TYPES[0] })}>
                      <Text style={{ color: active ? '#fff' : col, fontWeight: '700' }}>{tp === 'income' ? '📈 Income' : '📉 Expense'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <SelectField label="Venue" value={form.venue} options={VENUES} onChange={v => setForm({ ...form, venue: v })} isDark={isDark} />
              <View style={{ height: 12 }} />
              <SelectField label="Category" value={form.category} options={cats} onChange={v => setForm({ ...form, category: v })} isDark={isDark} />
              <View style={{ height: 12 }} />
              <Text style={[s.fieldLabel, { color: t.sub }]}>Amount (₹)</Text>
              <TextInput
                style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                value={form.amount} onChangeText={v => setForm({ ...form, amount: v })}
                keyboardType="numeric" placeholder="0" placeholderTextColor={t.sub}
              />
              <SelectField label="Payment Method" value={form.paymentMethod} options={PAYMENT_METHODS} onChange={v => setForm({ ...form, paymentMethod: v })} isDark={isDark} />
              <View style={{ height: 12 }} />
              <DateField label="Date" value={form.date} onChange={v => setForm({ ...form, date: v })} isDark={isDark} />
              <SelectField label="Status" value={form.status} options={STATUS_OPTIONS} onChange={v => setForm({ ...form, status: v as TxStatus })} isDark={isDark} />
              <View style={{ height: 12 }} />
              <Text style={[s.fieldLabel, { color: t.sub }]}>Comments</Text>
              <TextInput
                style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text, height: 70, textAlignVertical: 'top' }]}
                value={form.comments} onChangeText={v => setForm({ ...form, comments: v })}
                multiline placeholder="Optional notes..." placeholderTextColor={t.sub}
              />
              <TouchableOpacity style={[s.saveBtn, { backgroundColor: form.type === 'income' ? '#27ae60' : '#e74c3c' }]} onPress={onSave}>
                <Text style={s.saveTxt}>{isEdit ? 'Update Transaction' : 'Add Transaction'}</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── DetailModal ──────────────────────────────────────────────────────────────
function DetailModal({ tx, onClose, onEdit, onDelete, isDark }: {
  tx: Transaction | null; onClose(): void; onEdit(): void; onDelete(): void; isDark: boolean;
}) {
  const t = isDark ? dark : light;
  const insets = useSafeAreaInsets();
  if (!tx) return null;
  const inc = tx.type === 'income';
  const sc: Record<TxStatus, string> = { completed: '#27ae60', pending: '#f39c12', cancelled: '#e74c3c' };
  return (
    <Modal visible transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={{ position: 'absolute', bottom: 0, width: '100%' }}>
        <View style={[s.sheet, { backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Text style={[s.sheetTitle, { color: t.text }]}>Transaction Details</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose}><Text style={{ color: t.sub, fontSize: 22 }}>✕</Text></TouchableOpacity>
          </View>
          <View style={[s.detailAmt, { backgroundColor: inc ? '#27ae6015' : '#e74c3c15' }]}>
            <Text style={{ color: t.sub, fontSize: 12 }}>{tx.type.toUpperCase()}</Text>
            <Text style={{ color: inc ? '#27ae60' : '#e74c3c', fontSize: 28, fontWeight: '800', marginVertical: 4 }}>{fmt(tx.amount)}</Text>
            <View style={[s.txStatus, { backgroundColor: sc[tx.status] + '20', alignSelf: 'center' }]}>
              <Text style={{ color: sc[tx.status], fontWeight: '600' }}>{tx.status}</Text>
            </View>
          </View>
          {([['Category', tx.category], ['Venue', tx.venue], ['Date', tx.date], ['Payment', tx.paymentMethod], ['Comments', tx.comments || '—']] as [string,string][]).map(([k, v]) => (
            <View key={k} style={[s.detailRow, { borderBottomColor: t.border }]}>
              <Text style={{ color: t.sub, fontSize: 13, flex: 1 }}>{k}</Text>
              <Text style={{ color: t.text, fontSize: 13, flex: 2, textAlign: 'right' }}>{v}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[s.detailBtn, { backgroundColor: '#f39c12' }]} onPress={onEdit}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>✏️ Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.detailBtn, { backgroundColor: '#e74c3c' }]} onPress={onDelete}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>🗑 Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Source colors ────────────────────────────────────────────────────────────
const SOURCE_COLORS: Record<string, string> = {
  Bookings:  '#3498db',
  Decors:    '#9b59b6',
  Employees: '#e67e22',
  Rentals:   '#1abc9c',
  Manual:    '#6C63FF',
};

// ─── FeedRow ──────────────────────────────────────────────────────────────────
function FeedRow({ item, isDark }: { item: FeedItem; isDark: boolean }) {
  const t   = isDark ? dark : light;
  const inc = item.type === 'income';
  const sc: Record<string, string> = { completed: '#27ae60', pending: '#f39c12', cancelled: '#e74c3c' };
  const srcColor = SOURCE_COLORS[item.source] ?? '#888';
  return (
    <View style={[s.txRow, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <View style={[s.txBadge, { backgroundColor: srcColor + '20' }]}>
          <Text style={{ color: srcColor, fontSize: 10, fontWeight: '700' }}>{item.source.toUpperCase()}</Text>
        </View>
        <View style={[s.txBadge, { backgroundColor: inc ? '#27ae6020' : '#e74c3c20', marginLeft: 4 }]}>
          <Text style={{ color: inc ? '#27ae60' : '#e74c3c', fontSize: 10, fontWeight: '700' }}>{inc ? '+INC' : '-EXP'}</Text>
        </View>
        <Text style={[s.txCat, { color: t.text, marginLeft: 6 }]} numberOfLines={1}>{item.category}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ color: inc ? '#27ae60' : '#e74c3c', fontSize: 14, fontWeight: '800' }}>
          {inc ? '+' : '-'}{fmt(item.amount)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 2, marginBottom: 4 }}>
        {!!item.reference && <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>{item.reference}</Text>}
        {!!item.reference && <Text style={{ color: t.border }}> • </Text>}
        {!!item.venue && <Text style={{ color: t.sub, fontSize: 11 }} numberOfLines={1}>{item.venue}</Text>}
        {!!item.venue && <Text style={{ color: t.border }}> • </Text>}
        <Text style={{ color: t.sub, fontSize: 11 }}>📅 {item.eventDate || item.date}</Text>
        {item.eventDate && item.eventDate !== item.date && (
          <Text style={{ color: t.sub, fontSize: 10 }}> (paid {item.date})</Text>
        )}
        <View style={{ flex: 1 }} />
        <View style={[s.txStatus, { backgroundColor: (sc[item.status] ?? '#888') + '20' }]}>
          <Text style={{ color: sc[item.status] ?? '#888', fontSize: 10, fontWeight: '600' }}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
        </View>
      </View>
      {!!item.note && <Text style={{ color: t.sub, fontSize: 11 }} numberOfLines={1}>{item.note}</Text>}
    </View>
  );
}

// ─── SortModal ────────────────────────────────────────────────────────────────
function SortModal({ visible, current, onSelect, onClose, isDark }: {
  visible: boolean; current: SortKey; onSelect(k: SortKey): void; onClose(): void; isDark: boolean;
}) {
  const t = isDark ? dark : light;
  const insets = useSafeAreaInsets();
  const groups = [...new Set(SORT_OPTIONS.map(o => o.group))];
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[s.sheet, { backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, 20), position: 'absolute', bottom: 0, width: '100%' }]} onStartShouldSetResponder={() => true}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Text style={[s.sheetTitle, { color: t.text }]}>Sort By</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose}><Text style={{ color: t.sub, fontSize: 22 }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {groups.map(grp => (
              <View key={grp} style={{ marginBottom: 12 }}>
                <Text style={{ color: t.sub, fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.8 }}>{grp.toUpperCase()}</Text>
                {SORT_OPTIONS.filter(o => o.group === grp).map(opt => {
                  const active = current === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[s.sortRow, { borderColor: active ? '#6C63FF40' : t.border, backgroundColor: active ? '#6C63FF12' : 'transparent' }]}
                      onPress={() => { onSelect(opt.key); onClose(); }}
                    >
                      <Text style={{ fontSize: 17, marginRight: 12 }}>{opt.icon}</Text>
                      <Text style={{ color: active ? '#6C63FF' : t.text, fontWeight: active ? '700' : '400', fontSize: 14, flex: 1 }}>{opt.label}</Text>
                      {active && <Text style={{ color: '#6C63FF', fontSize: 16 }}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <View style={{ height: 16 }} />
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── KpiTile ──────────────────────────────────────────────────────────────────
function KpiTile({ label, amount, sub, color, isDark }: {
  label: string; amount: number; sub: string; color: string; isDark: boolean;
}) {
  const t = isDark ? dark : light;
  return (
    <View style={{ width: (W - 44) / 2, backgroundColor: t.card, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: color + '35' }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
      </View>
      <Text style={{ color: t.sub, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 }}>{label.toUpperCase()}</Text>
      <Text style={{ color, fontSize: 19, fontWeight: '800', letterSpacing: -0.5 }}>{fmt(amount)}</Text>
      <Text style={{ color: t.sub, fontSize: 10, marginTop: 5 }} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

// ─── SnapRow ──────────────────────────────────────────────────────────────────
function SnapRow({ label, sub, inc, exp, net, highlight, isDark }: {
  label: string; sub: string; inc: number; exp: number; net: number; highlight?: boolean; isDark: boolean;
}) {
  const t = isDark ? dark : light;
  const isPos = net >= 0;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
      borderBottomWidth: 1, borderBottomColor: t.border,
      backgroundColor: highlight ? (isDark ? 'rgba(108,99,255,0.1)' : 'rgba(108,99,255,0.06)') : 'transparent',
      borderRadius: highlight ? 10 : 0,
      marginHorizontal: highlight ? -4 : 0, paddingHorizontal: highlight ? 4 : 0,
    }}>
      <View style={{ flex: 2.5 }}>
        <Text style={{ color: highlight ? '#6C63FF' : t.text, fontSize: 12, fontWeight: highlight ? '800' : '600' }}>{label}</Text>
        <Text style={{ color: t.sub, fontSize: 10, marginTop: 1 }}>{sub}</Text>
      </View>
      <Text style={{ flex: 1, color: '#27ae60', fontSize: 12, fontWeight: '600', textAlign: 'right' }}>{fmt(inc)}</Text>
      <Text style={{ flex: 1, color: '#e74c3c', fontSize: 12, fontWeight: '600', textAlign: 'right' }}>{fmt(exp)}</Text>
      <Text style={{ flex: 1, color: isPos ? '#6C63FF' : '#e74c3c', fontSize: 12, fontWeight: '800', textAlign: 'right' }}>
        {isPos ? '+' : '-'}{fmt(Math.abs(net))}
      </Text>
    </View>
  );
}

// ─── ProgRow ──────────────────────────────────────────────────────────────────
function ProgRow({ item, t, srcColors }: { item: FeedItem; t: typeof light; srcColors: Record<string,string> }) {
  const srcColor = srcColors[item.source] ?? '#888';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border + '80' }}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: srcColor + '20' }}>
            <Text style={{ color: srcColor, fontSize: 9, fontWeight: '700' }}>{item.source.toUpperCase()}</Text>
          </View>
          <Text style={{ color: t.text, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>
            {item.reference || item.note || item.category}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: t.sub, fontSize: 11 }}>📅 {evDate(item)}</Text>
          {!!item.venue && <Text style={{ color: t.sub, fontSize: 11 }}>🏛 {item.venue}</Text>}
        </View>
        {!!item.note && item.note !== item.reference && (
          <Text style={{ color: t.sub, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{item.note}</Text>
        )}
      </View>
      <Text style={{ color: '#27ae60', fontSize: 14, fontWeight: '800', marginLeft: 10 }}>{fmt(item.amount)}</Text>
    </View>
  );
}

// ─── Booking-level helpers for Yearly Overview ────────────────────────────────
const bkRev   = (b: BookingDoc) => b.payments.reduce((s, p) => s + p.amount, 0);
const bkExp   = (b: BookingDoc) => b.expenses.reduce((s, e) => s + e.amount, 0);
const bkDecor = (b: BookingDoc) => b.decorCost ?? 0;
const bkNet   = (b: BookingDoc) => bkRev(b) - bkExp(b);

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AccountsScreen() {
  const scheme = useColorScheme();
  const [isDark, setIsDark] = useState(scheme === 'dark');
  const t = isDark ? dark : light;
  const router = useRouter();

  const [txs, setTxs]           = useState<Transaction[]>([]);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState<Period>('All Time');
  const [venue, setVenue]       = useState('All Venues');
  const [typeF, setTypeF]       = useState<TxFilter>('All');
  const [search, setSearch]     = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [editTx, setEditTx]     = useState<Transaction | null>(null);
  const [viewTx, setViewTx]     = useState<Transaction | null>(null);
  const [form, setForm]         = useState<TxForm>(emptyForm());
  const [isEdit, setIsEdit]     = useState(false);
  const [sortKey, setSortKey]   = useState<SortKey>('date-desc');
  const [showSort, setShowSort] = useState(false);

  // ── Activity Feed ──────────────────────────────────────────────────────────
  type ViewMode = 'manual' | 'feed';
  const [viewMode, setViewMode]         = useState<ViewMode>('manual');
  const [feedItems, setFeedItems]       = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading]   = useState(false);
  const [feedSource, setFeedSource]     = useState<string>('All');
  const [feedSearch, setFeedSearch]     = useState('');
  const [refDate,    setRefDate]        = useState(TODAY); // which month/year is selected

  // ── Yearly Financial Overview ────────────────────────────────────────────────
  const [yYear,     setYYear]     = useState(new Date().getFullYear());
  const [yVenue,    setYVenue]    = useState('All Venues');
  const [yBookings, setYBookings] = useState<BookingDoc[]>([]);
  const [yLoading,  setYLoading]  = useState(false);
  const [yExpanded, setYExpanded] = useState<Set<number>>(new Set());

  const loadTxs = useCallback(async () => {
    try {
      const data = await transactionsApi.getAll();
      setTxs(data.map(d => ({ ...d, id: d._id })));
    } catch (e: any) {
      Alert.alert('Error', 'Could not load transactions: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const data = await accountsApi.getFeed();
      setFeedItems(data);
    } catch (e: any) {
      Alert.alert('Error', 'Could not load activity feed: ' + e.message);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  // Refresh on every tab focus — feed drives the dashboard, txs drives the manual edit list
  useFocusEffect(useCallback(() => { loadTxs(); loadFeed(); }, [loadTxs, loadFeed]));

  // Fetch yearly bookings whenever year or venue filter changes
  useEffect(() => {
    setYLoading(true);
    setYExpanded(new Set());
    const params: { venue?: string } = {};
    if (yVenue !== 'All Venues') params.venue = yVenue;
    bookingsApi.getAll(params)
      .then(all => setYBookings(all.filter(b => new Date(b.date).getFullYear() === yYear)))
      .catch(() => {})
      .finally(() => setYLoading(false));
  }, [yYear, yVenue]);

  function toggleMonth(mi: number) {
    setYExpanded(prev => {
      const next = new Set(prev);
      next.has(mi) ? next.delete(mi) : next.add(mi);
      return next;
    });
  }

  // ── Manual transactions list (for the editable Manual tab) ────────────────
  const filtered = useMemo(() => txs.filter(tx => {
    const pOk = isInPeriod(tx.date, period, refDate);
    const vOk = venue === 'All Venues' || tx.venue === venue;
    const tOk = typeF === 'All' || (typeF === 'Income' ? tx.type === 'income' : tx.type === 'expense');
    const sOk = !search || [tx.category, tx.venue, tx.comments].some(f => f.toLowerCase().includes(search.toLowerCase()));
    return pOk && vOk && tOk && sOk;
  }), [txs, period, refDate, venue, typeF, search]);

  const ML_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Yearly overview — per-month breakdown of fetched yBookings
  const monthData = useMemo(() =>
    Array.from({ length: 12 }, (_, mi) => {
      const mBooks = yBookings.filter(b => new Date(b.date).getMonth() === mi);
      return {
        mi,
        label:    ML_FULL[mi],
        bookings: mBooks,
        count:    mBooks.length,
        revenue:  mBooks.reduce((s, b) => s + bkRev(b),   0),
        expenses: mBooks.reduce((s, b) => s + bkExp(b),   0),
        net:      mBooks.reduce((s, b) => s + bkNet(b),   0),
      };
    })
  , [yBookings]);

  const yTotal = useMemo(() => ({
    count:    yBookings.length,
    revenue:  yBookings.reduce((s, b) => s + bkRev(b), 0),
    expenses: yBookings.reduce((s, b) => s + bkExp(b), 0),
    net:      yBookings.reduce((s, b) => s + bkNet(b), 0),
  }), [yBookings]);

  function openAdd() { setForm(emptyForm()); setIsEdit(false); setEditTx(null); setShowAdd(true); }
  function openEdit(tx: Transaction) { setForm({ ...tx, amount: String(tx.amount) }); setIsEdit(true); setEditTx(tx); setShowAdd(true); }

  async function handleSave() {
    const amt = parseFloat(form.amount);
    if (!form.venue || !form.category || isNaN(amt) || amt <= 0 || !form.date) {
      if (Platform.OS === 'web') window.alert('Please fill all required fields.');
      else Alert.alert('Validation', 'Please fill all required fields.');
      return;
    }
    try {
      const payload = { ...form, amount: amt };
      if (isEdit && editTx) {
        const updated = await transactionsApi.update(editTx.id, payload);
        setTxs(prev => prev.map(x => x.id === editTx.id ? { ...updated, id: updated._id } : x));
      } else {
        const created = await transactionsApi.create(payload);
        setTxs(prev => [{ ...created, id: created._id }, ...prev]);
      }
      setShowAdd(false); setEditTx(null);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  function handleDelete(id: string) {
    const del = async () => {
      try {
        await transactionsApi.remove(id);
        setTxs(prev => prev.filter(x => x.id !== id));
      } catch (e: any) {
        Alert.alert('Error', e.message);
      }
    };
    if (Platform.OS === 'web') { if (window.confirm('Delete this transaction?')) del(); }
    else Alert.alert('Delete', 'Delete this transaction?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: del }]);
  }

  async function handlePrint(tx: Transaction) {
    const html = `<html><body style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#6C63FF">Transaction Receipt</h2>
      <hr/>
      <p><b>Type:</b> ${tx.type.toUpperCase()}</p>
      <p><b>Category:</b> ${tx.category}</p>
      <p><b>Venue:</b> ${tx.venue}</p>
      <p><b>Amount:</b> ₹${tx.amount.toLocaleString('en-IN')}</p>
      <p><b>Payment Method:</b> ${tx.paymentMethod}</p>
      <p><b>Date:</b> ${tx.date}</p>
      <p><b>Status:</b> ${tx.status}</p>
      ${tx.comments ? `<p><b>Comments:</b> ${tx.comments}</p>` : ''}
      <hr/><p style="color:#999;font-size:12px">Generated by A1 Groups App</p>
    </body></html>`;
    try { const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri); } catch {}
  }

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortKey) {
      case 'date-desc':    return arr.sort((a, b) => b.date.localeCompare(a.date));
      case 'date-asc':     return arr.sort((a, b) => a.date.localeCompare(b.date));
      case 'amount-desc':  return arr.sort((a, b) => b.amount - a.amount);
      case 'amount-asc':   return arr.sort((a, b) => a.amount - b.amount);
      case 'venue-az':     return arr.sort((a, b) => a.venue.localeCompare(b.venue));
      case 'category-az':  return arr.sort((a, b) => a.category.localeCompare(b.category));
      case 'type-income':  return arr.sort((a, b) => (a.type === 'income' ? -1 : 1) - (b.type === 'income' ? -1 : 1));
      case 'type-expense': return arr.sort((a, b) => (a.type === 'expense' ? -1 : 1) - (b.type === 'expense' ? -1 : 1));
      case 'status':       return arr.sort((a, b) => a.status.localeCompare(b.status));
      default:             return arr.sort((a, b) => b.date.localeCompare(a.date));
    }
  }, [filtered, sortKey]);

  if (loading || feedLoading) return (
    <SafeAreaView style={[s.safe, { backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: 36, marginBottom: 12 }}>💰</Text>
      <Text style={{ color: t.sub, fontSize: 15 }}>Loading financial data…</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: t.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <View style={[s.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
          <Text style={[s.headerTitle, { color: t.text }]}>Accounts</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[s.iconBtn, { backgroundColor: isDark ? '#ffffff15' : '#6C63FF15' }]} onPress={() => setIsDark(!isDark)}>
              <Text>{isDark ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.addBtn, { backgroundColor: '#6C63FF' }]} onPress={openAdd}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>+ Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── YEARLY FINANCIAL OVERVIEW ──────────────────────────────────── */}
        <Text style={[s.sectionTitle, { color: t.text }]}>Yearly Financial Overview</Text>

        {/* Year + Venue selectors */}
        <View style={[s.chartCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={{ color: t.sub, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }}>SELECT YEAR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            {yearPickerList().map(y => {
              const active = yYear === y.year;
              return (
                <TouchableOpacity key={y.year}
                  style={[s.chip, { backgroundColor: active ? '#6C63FF' : t.bg, borderColor: active ? '#6C63FF' : t.border, paddingHorizontal: 18, marginRight: 8 }]}
                  onPress={() => setYYear(y.year)}>
                  <Text style={{ color: active ? '#fff' : t.sub, fontWeight: active ? '800' : '500', fontSize: 14 }}>{y.year}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={{ color: t.sub, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }}>VENUE FILTER</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {['All Venues', ...VENUES].map(v => {
              const active = yVenue === v;
              return (
                <TouchableOpacity key={v}
                  style={[s.venueChip, { backgroundColor: active ? '#6C63FF20' : 'transparent', borderColor: active ? '#6C63FF' : t.border, marginRight: 6 }]}
                  onPress={() => setYVenue(v)}>
                  <Text style={{ color: active ? '#6C63FF' : t.sub, fontSize: 11, fontWeight: active ? '700' : '400' }}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Year summary banner */}
        {!yLoading && (
          <View style={[s.chartCard, { backgroundColor: '#6C63FF', borderColor: '#6C63FF', paddingVertical: 18 }]}>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', marginBottom: 10 }}>
              {yYear}  ·  {yVenue !== 'All Venues' ? yVenue : 'All Venues'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 0 }}>
              {[
                { label: 'BOOKINGS',   val: String(yTotal.count)       },
                { label: 'REVENUE',    val: fmt(yTotal.revenue)         },
                { label: 'EXPENSES',   val: fmt(yTotal.expenses)        },
                { label: 'NET PROFIT', val: fmt(yTotal.net)             },
              ].map((item, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.2)' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: '700', marginBottom: 4 }}>{item.label}</Text>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{item.val}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Monthly accordion rows */}
        {yLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <ActivityIndicator color="#6C63FF" size="large" />
            <Text style={{ color: t.sub, marginTop: 12, fontSize: 13 }}>Loading {yYear} data…</Text>
          </View>
        ) : monthData.map(m => {
          const isOpen = yExpanded.has(m.mi);
          const hasData = m.count > 0;
          return (
            <View key={m.mi} style={[s.chartCard, { backgroundColor: t.card, borderColor: hasData ? t.border : t.border + '60', padding: 0, overflow: 'hidden', marginBottom: 8 }]}>

              {/* ── Accordion header ─────────────────────────────── */}
              <TouchableOpacity
                style={{ padding: 14 }}
                onPress={() => hasData && toggleMonth(m.mi)}
                activeOpacity={hasData ? 0.7 : 1}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Month colour dot */}
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: hasData ? '#6C63FF' : t.sub, marginRight: 10 }} />

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: hasData ? t.text : t.sub, fontSize: 14, fontWeight: hasData ? '700' : '500', marginBottom: 5 }}>
                      {m.label} {yYear}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      <Text style={{ color: t.sub, fontSize: 11 }}>
                        <Text style={{ color: t.text, fontWeight: '700' }}>{m.count}</Text> bookings
                      </Text>
                      <Text style={{ color: '#27ae60', fontSize: 11, fontWeight: '600' }}>↑ {fmt(m.revenue)}</Text>
                      <Text style={{ color: '#e74c3c', fontSize: 11, fontWeight: '600' }}>↓ {fmt(m.expenses)}</Text>
                      <Text style={{ color: m.net >= 0 ? '#6C63FF' : '#e74c3c', fontSize: 11, fontWeight: '800' }}>
                        Net {m.net >= 0 ? '+' : ''}{fmt(m.net)}
                      </Text>
                    </View>
                  </View>

                  {hasData ? (
                    <Text style={{ color: '#6C63FF', fontSize: 16, marginLeft: 8 }}>{isOpen ? '▲' : '▼'}</Text>
                  ) : (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: t.border }}>
                      <Text style={{ color: t.sub, fontSize: 10 }}>No bookings</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              {/* ── Expanded booking details ──────────────────────── */}
              {isOpen && (
                <View style={{ borderTopWidth: 1, borderTopColor: t.border }}>

                  {/* Column headers */}
                  <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}>
                    <Text style={{ flex: 2.5, color: t.sub, fontSize: 9, fontWeight: '700', letterSpacing: 0.4 }}>CUSTOMER / EVENT</Text>
                    <Text style={{ flex: 1, color: '#27ae60', fontSize: 9, fontWeight: '700', textAlign: 'right' }}>REVENUE</Text>
                    <Text style={{ flex: 1, color: '#e74c3c', fontSize: 9, fontWeight: '700', textAlign: 'right' }}>EXPENSES</Text>
                    <Text style={{ flex: 1, color: '#9b59b6', fontSize: 9, fontWeight: '700', textAlign: 'right' }}>DECOR</Text>
                    <Text style={{ flex: 1, color: '#6C63FF', fontSize: 9, fontWeight: '700', textAlign: 'right' }}>NET</Text>
                  </View>

                  {/* Booking rows */}
                  {m.bookings
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((b, bi) => {
                      const rev   = bkRev(b);
                      const xp    = bkExp(b);
                      const decor = bkDecor(b);
                      const net   = bkNet(b);
                      return (
                        <TouchableOpacity
                          key={b._id}
                          activeOpacity={0.65}
                          onPress={() => router.push({ pathname: '/(tabs)/bookings', params: { bookingId: b._id } } as any)}
                          style={{
                            paddingHorizontal: 14, paddingVertical: 11,
                            borderBottomWidth: 1, borderBottomColor: t.border,
                            backgroundColor: bi % 2 === 1 ? (isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.018)') : 'transparent',
                          }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 2.5 }}>
                              <Text style={{ color: t.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                                {b.client || '—'}
                              </Text>
                              <Text style={{ color: t.sub, fontSize: 10, marginTop: 2 }}>
                                📅 {b.date}  ·  {b.venue}
                              </Text>
                              {!!b.eventName && (
                                <Text style={{ color: t.sub, fontSize: 10 }} numberOfLines={1}>{b.eventName}</Text>
                              )}
                            </View>
                            <Text style={{ flex: 1, color: '#27ae60', fontSize: 12, fontWeight: '700', textAlign: 'right' }}>{fmt(rev)}</Text>
                            <Text style={{ flex: 1, color: '#e74c3c', fontSize: 12, fontWeight: '700', textAlign: 'right' }}>{fmt(xp)}</Text>
                            <Text style={{ flex: 1, color: decor > 0 ? '#9b59b6' : t.sub, fontSize: 12, fontWeight: '700', textAlign: 'right' }}>
                              {decor > 0 ? fmt(decor) : '—'}
                            </Text>
                            <Text style={{ flex: 1, color: net >= 0 ? '#6C63FF' : '#e74c3c', fontSize: 12, fontWeight: '800', textAlign: 'right' }}>
                              {net >= 0 ? '+' : ''}{fmt(net)}
                            </Text>
                            <Text style={{ color: t.sub, fontSize: 13, marginLeft: 6 }}>›</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}

                  {/* Monthly totals footer */}
                  <View style={{ paddingHorizontal: 14, paddingVertical: 14, backgroundColor: isDark ? 'rgba(108,99,255,0.12)' : 'rgba(108,99,255,0.07)' }}>
                    <Text style={{ color: '#6C63FF', fontSize: 11, fontWeight: '800', marginBottom: 10 }}>
                      Monthly Totals — {m.label}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 0 }}>
                      {[
                        { label: 'REVENUE',    val: fmt(m.revenue),  color: '#27ae60' },
                        { label: 'EXPENSES',   val: fmt(m.expenses), color: '#e74c3c' },
                        { label: 'NET PROFIT', val: `${m.net >= 0 ? '+' : ''}${fmt(m.net)}`, color: m.net >= 0 ? '#6C63FF' : '#e74c3c' },
                      ].map((item, i) => (
                        <View key={i} style={{ flex: 1, alignItems: i === 0 ? 'flex-start' : i === 2 ? 'flex-end' : 'center' }}>
                          <Text style={{ color: t.sub, fontSize: 9, fontWeight: '700', marginBottom: 3 }}>{item.label}</Text>
                          <Text style={{ color: item.color, fontSize: 15, fontWeight: '800' }}>{item.val}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {/* ── ACTIVITY ───────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 4, marginBottom: 12, gap: 8 }}>
          <TouchableOpacity style={[s.typeChip, { backgroundColor: viewMode === 'manual' ? '#6C63FF' : t.card, borderColor: viewMode === 'manual' ? '#6C63FF' : t.border }]}
            onPress={() => setViewMode('manual')}>
            <Text style={{ color: viewMode === 'manual' ? '#fff' : t.text, fontWeight: '700', fontSize: 13 }}>📋 Manual</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.typeChip, { backgroundColor: viewMode === 'feed' ? '#6C63FF' : t.card, borderColor: viewMode === 'feed' ? '#6C63FF' : t.border }]}
            onPress={() => setViewMode('feed')}>
            <Text style={{ color: viewMode === 'feed' ? '#fff' : t.text, fontWeight: '700', fontSize: 13 }}>🔄 All Activity</Text>
          </TouchableOpacity>
        </View>

        {viewMode === 'manual' ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
              <Text style={[s.sectionTitle, { color: t.text, marginBottom: 0, paddingHorizontal: 0, flex: 1 }]}>
                Transactions ({filtered.length})
              </Text>
              <TouchableOpacity
                style={[s.sortBtn, { backgroundColor: sortKey !== 'date-desc' ? '#6C63FF' : t.card, borderColor: sortKey !== 'date-desc' ? '#6C63FF' : t.border }]}
                onPress={() => setShowSort(true)}>
                <Text style={{ fontSize: 15, color: sortKey !== 'date-desc' ? '#fff' : t.text }}>⇅ Sort</Text>
              </TouchableOpacity>
            </View>
            {sortKey !== 'date-desc' && (
              <View style={{ paddingHorizontal: 16, marginBottom: 6 }}>
                <Text style={{ color: '#6C63FF', fontSize: 12 }}>
                  {SORT_OPTIONS.find(o => o.key === sortKey)?.icon} {SORT_OPTIONS.find(o => o.key === sortKey)?.label}
                </Text>
              </View>
            )}
            <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
              <TextInput style={[s.searchBox, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                value={search} onChangeText={setSearch}
                placeholder="Search transactions…" placeholderTextColor={t.sub} />
            </View>
            {sorted.length === 0 ? (
              <View style={{ alignItems: 'center', padding: 32 }}>
                <Text style={{ fontSize: 40 }}>📂</Text>
                <Text style={{ color: t.sub, marginTop: 8 }}>No transactions found</Text>
              </View>
            ) : sorted.map(tx => (
              <TxRow key={tx.id} tx={tx} isDark={isDark}
                onView={() => setViewTx(tx)} onEdit={() => openEdit(tx)}
                onDelete={() => handleDelete(tx.id)} onPrint={() => handlePrint(tx)} />
            ))}
          </>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              {['All', 'Bookings', 'Decors', 'Employees', 'Rentals', 'Manual'].map(src => {
                const active = feedSource === src;
                const col = src === 'All' ? '#6C63FF' : SOURCE_COLORS[src] ?? '#6C63FF';
                return (
                  <TouchableOpacity key={src}
                    style={[s.venueChip, { backgroundColor: active ? col + '20' : 'transparent', borderColor: active ? col : t.border }]}
                    onPress={() => setFeedSource(src)}>
                    <Text style={{ color: active ? col : t.sub, fontSize: 12, fontWeight: active ? '700' : '400' }}>{src}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ paddingHorizontal: 16, marginBottom: 10, flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.searchBox, { backgroundColor: t.card, borderColor: t.border, color: t.text, flex: 1 }]}
                value={feedSearch} onChangeText={setFeedSearch}
                placeholder="Search activity…" placeholderTextColor={t.sub} />
              <TouchableOpacity style={[s.sortBtn, { backgroundColor: t.card, borderColor: t.border }]}
                onPress={() => { loadFeed(); loadTxs(); }}>
                <Text style={{ color: t.text, fontSize: 15 }}>{feedLoading ? '⏳' : '↻'}</Text>
              </TouchableOpacity>
            </View>
            {(() => {
              const displayFeed = feedItems.filter(item => {
                const srcOk    = feedSource === 'All' || item.source === feedSource;
                const periodOk = isInPeriod(evDate(item), period, refDate);
                const searchOk = !feedSearch || [item.category, item.reference, item.venue, item.note]
                  .some(f => f?.toLowerCase().includes(feedSearch.toLowerCase()));
                return srcOk && periodOk && searchOk;
              });
              return (
                <>
                  <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
                    <Text style={{ color: t.sub, fontSize: 12 }}>
                      {displayFeed.length} entries · {feedSource !== 'All' ? feedSource : 'All Sources'}
                    </Text>
                  </View>
                  {feedLoading ? (
                    <View style={{ alignItems: 'center', padding: 32 }}>
                      <Text style={{ color: t.sub }}>Loading activity…</Text>
                    </View>
                  ) : displayFeed.length === 0 ? (
                    <View style={{ alignItems: 'center', padding: 32 }}>
                      <Text style={{ fontSize: 40 }}>📭</Text>
                      <Text style={{ color: t.sub, marginTop: 8 }}>No activity found</Text>
                    </View>
                  ) : displayFeed.map(item => <FeedRow key={item.id} item={item} isDark={isDark} />)}
                </>
              );
            })()}
          </>
        )}

      </ScrollView>

      <TxModal visible={showAdd} form={form} setForm={setForm} onSave={handleSave}
        onClose={() => { setShowAdd(false); setEditTx(null); }} isDark={isDark} isEdit={isEdit} />
      <DetailModal tx={viewTx} onClose={() => setViewTx(null)}
        onEdit={() => { if (viewTx) { openEdit(viewTx); setViewTx(null); } }}
        onDelete={() => { if (viewTx) { handleDelete(viewTx.id); setViewTx(null); } }}
        isDark={isDark} />
      <SortModal visible={showSort} current={sortKey} onSelect={setSortKey} onClose={() => setShowSort(false)} isDark={isDark} />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:        { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  iconBtn:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addBtn:      { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  venueChip:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  typeChip:    { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, gap: 10, marginVertical: 4 },
  summaryCard: { width: (W - 52) / 2, padding: 14, borderRadius: 16, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  summaryIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  summaryTitle:{ fontSize: 11, fontWeight: '600', letterSpacing: 0.2, marginBottom: 3 },
  summaryAmt:  { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sectionTitle:{ fontSize: 16, fontWeight: '700', marginBottom: 10, paddingHorizontal: 16, letterSpacing: -0.2 },
  chartCard:   { marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  chartTitle:  { fontSize: 15, fontWeight: '700', marginBottom: 14, letterSpacing: -0.2 },
  venueCard:   { width: 168, padding: 16, borderRadius: 16, borderWidth: 1, marginRight: 10 },
  txRow:       { marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 16, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  txBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 8 },
  txCat:       { fontSize: 14, fontWeight: '600' },
  txStatus:    { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  txBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  searchBox:   { padding: 12, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:       { maxHeight: SHEET_MAX_H, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  sheetTitle:  { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  fieldLabel:  { fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.2 },
  selectTrigger: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginBottom: 0 },
  selectPanel: { margin: 20, borderRadius: 16, borderWidth: 1, padding: 14 },
  selectSearch:{ padding: 11, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  selectOpt:   { padding: 13, borderRadius: 8 },
  input:       { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12, fontSize: 14 },
  typeBtn:     { flex: 1, padding: 11, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  saveBtn:     { padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  saveTxt:     { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.2 },
  detailAmt:   { padding: 18, borderRadius: 16, alignItems: 'center', marginBottom: 14 },
  detailRow:   { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1 },
  detailBtn:   { flex: 1, padding: 13, borderRadius: 12, alignItems: 'center' },
  sortBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  sortRow:     { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 8, borderWidth: 1 },
});
