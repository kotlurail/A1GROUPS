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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { decorsApi, bookingsApi, uploadApi, BookingDoc } from '../../lib/api';
import * as Clipboard from 'expo-clipboard';
import { useDecorItems } from '../../lib/useDecorItems';
import ManageDecorItemsModal from '../../lib/ManageDecorItemsModal';
import ImageViewer from '../../lib/ImageViewer';

let ImagePicker: any = null;
try { ImagePicker = require('expo-image-picker'); } catch {}

const { width: SW, height: SH } = Dimensions.get('window');

// ── Types ──────────────────────────────────────────────────────────────────────
type PaymentStatus = 'pending' | 'partial' | 'completed';

interface DecorItem {
  id: string;
  name: string;
  quantity: number;
  costPerUnit: number;
}

interface RequiredItem {
  id: string;
  name: string;
  quantity: number;
  description: string;
}

interface DecorEntry {
  id: string;
  eventName: string;
  eventType: string;
  customerName: string;
  mobile: string;
  eventDate: string;
  location: string;
  images: string[];
  decorItems: DecorItem[];
  requiredItems: RequiredItem[];
  advanceAmount: number;
  settledAmount: number;
  quotedAmount: number;
  paymentStatus: PaymentStatus;
  comments: string;
  createdDate: string;
  bookingId?: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const EVENT_TYPES = [
  'Reception','Engagement','Wedding','Birthday','Half Saree',
  'Dhoti Ceremony','Haldi','Sangeeth','Baby Shower',
  'Anniversary','Corporate Event','Others',
];


const SORT_OPTIONS = ['Newest First','Oldest First','Upcoming First','Cost: High to Low','Cost: Low to High'];

const PAY_COLOR: Record<PaymentStatus, string> = {
  pending: '#e74c3c', partial: '#f39c12', completed: '#27ae60',
};
const PAY_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pending', partial: 'Partial', completed: 'Completed',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtMoney(n: number) { return '₹' + n.toLocaleString('en-IN'); }
function nowDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isValidDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime()); }
function fmtDate(d: string) {
  if (!isValidDate(d)) return d;
  const dt = new Date(d + 'T00:00:00');
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dt.getDate()} ${M[dt.getMonth()]} ${dt.getFullYear()}`;
}
function decorTotal(e: DecorEntry) {
  return e.decorItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
}
function effectiveTotal(e: DecorEntry) {
  return e.quotedAmount > 0 ? e.quotedAmount : decorTotal(e);
}
function calcBalance(e: DecorEntry) {
  return Math.max(0, effectiveTotal(e) - e.advanceAmount - e.settledAmount);
}
function autoStatus(e: DecorEntry): PaymentStatus {
  const paid = e.advanceAmount + e.settledAmount;
  const total = effectiveTotal(e);
  if (total > 0 && paid >= total) return 'completed';
  if (paid > 0) return 'partial';
  return 'pending';
}
function isUpcoming(e: DecorEntry) { return e.eventDate >= nowDate(); }
function uid() { return Date.now().toString() + Math.random().toString(36).slice(2, 6); }

function normalizeDecor(d: any): DecorEntry {
  return {
    id: d._id,
    eventName: d.eventName ?? '',
    eventType: d.eventType ?? '',
    customerName: d.customerName ?? '',
    mobile: d.mobile ?? '',
    eventDate: d.eventDate ?? '',
    location: d.location ?? '',
    images: d.images ?? [],
    decorItems: (d.decorItems ?? []).map((i: any) => ({
      id: i._id ?? uid(), name: i.name ?? '', quantity: i.quantity ?? 1, costPerUnit: i.costPerUnit ?? 0,
    })),
    requiredItems: (d.requiredItems ?? []).map((r: any) => ({
      id: r._id ?? uid(), name: r.name ?? '', quantity: r.quantity ?? 1, description: r.description ?? '',
    })),
    advanceAmount: d.advanceAmount ?? 0,
    settledAmount: d.settledAmount ?? 0,
    quotedAmount:  d.quotedAmount  ?? 0,
    paymentStatus: d.paymentStatus ?? 'pending',
    comments: d.comments ?? '',
    createdDate: d.createdDate ?? '',
    bookingId: d.bookingId ?? undefined,
  };
}

function toDecorPayload(entry: DecorEntry) {
  const { id: _id, ...rest } = entry;
  return {
    ...rest,
    bookingId: entry.bookingId ?? null,
    decorItems: entry.decorItems.map(({ id: _i, ...item }) => item),
    requiredItems: entry.requiredItems.map(({ id: _i, ...item }) => item),
  };
}

// ── DatePickerField ────────────────────────────────────────────────────────────
let RNDateTimePicker: any = null;
if (Platform.OS !== 'web') {
  try { RNDateTimePicker = require('@react-native-community/datetimepicker').default; } catch {}
}

function DatePickerField({ value, onChange, style }: { value: string; onChange: (d: string) => void; style?: any }) {
  const [show, setShow] = useState(false);
  const dateObj = isValidDate(value) ? new Date(value + 'T12:00:00') : new Date();
  const base = { backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', overflow: 'hidden' as const };
  if (Platform.OS === 'web') {
    return (
      <View style={[base, style]}>
        <input type="date" value={value} onChange={(e: any) => onChange(e.target.value)}
          style={{ border: 'none', background: 'transparent', fontSize: 14, color: value ? '#1A1A2E' : '#9B98C0', width: '100%', padding: '10px 12px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' } as any} />
      </View>
    );
  }
  return (
    <>
      <TouchableOpacity style={[base, { paddingHorizontal: 12, paddingVertical: 12 }, style]} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={{ fontSize: 14, color: value ? '#1A1A2E' : '#9B98C0' }}>{value || 'Select date'}</Text>
      </TouchableOpacity>
      {show && RNDateTimePicker && (
        <RNDateTimePicker value={dateObj} mode="date" display="default"
          onChange={(_: any, date?: Date) => {
            setShow(false);
            if (date) onChange(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
          }} />
      )}
    </>
  );
}

// ── Searchable Select ──────────────────────────────────────────────────────────
function SelectField({ value, options, onChange, placeholder, style, allowCustom, onAddCustom }: {
  value: string; options: string[]; onChange: (v: string) => void;
  placeholder?: string; style?: any; allowCustom?: boolean; onAddCustom?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<TextInput>(null);
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const trimmed = search.trim();
  const canAdd = allowCustom && trimmed.length > 0 && !options.some(o => o.toLowerCase() === trimmed.toLowerCase());

  // Delay focus so modal animation finishes before keyboard appears — prevents
  // the keyboard-show event from triggering the backdrop and closing the dropdown.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  function pick(v: string, isNew = false) {
    onChange(v);
    if (isNew && onAddCustom) onAddCustom(v);
    setOpen(false); setSearch('');
  }

  return (
    <>
      <TouchableOpacity style={[sel.trigger, style]} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={[sel.triggerTxt, !value && { color: '#9B98C0' }]} numberOfLines={1}>{value || (placeholder ?? 'Select...')}</Text>
        <Text style={sel.arrow}>&#9660;</Text>
      </TouchableOpacity>
      <Modal transparent statusBarTranslucent animationType="fade" visible={open} onRequestClose={() => { setOpen(false); setSearch(''); }}>
        <View style={{ flex: 1 }}>
          {/* Backdrop sits behind everything — absolutely fills the screen */}
          <TouchableOpacity
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.42)' }]}
            onPress={() => { setOpen(false); setSearch(''); }}
            activeOpacity={1}
          />
          {/* Centering wrapper — box-none means this View itself never receives touches,
              so taps outside the sheet fall through to the backdrop above */}
          <View style={sel.centerer} pointerEvents="box-none">
            <View style={sel.sheet}>
              <TextInput ref={inputRef} style={sel.search} placeholder="Search or type new item..." value={search} onChangeText={setSearch} placeholderTextColor="#9B98C0" />
              <ScrollView style={{ maxHeight: Math.min(320, SH * 0.45) }} keyboardShouldPersistTaps="handled">
                {canAdd && (
                  <TouchableOpacity style={[sel.option, { backgroundColor: 'rgba(123,97,255,0.08)', borderRadius: 10, marginBottom: 4 }]}
                    onPress={() => pick(trimmed, true)}>
                    <Text style={[sel.optionTxt, { color: '#7B61FF', fontWeight: '700' }]}>+ Add "{trimmed}"</Text>
                  </TouchableOpacity>
                )}
                {filtered.map(o => (
                  <TouchableOpacity key={o} style={[sel.option, value === o && sel.optionActive]}
                    onPress={() => pick(o)}>
                    <Text style={[sel.optionTxt, value === o && sel.optionActiveTxt]}>{o}</Text>
                    {value === o && <Text style={{ color: '#7B61FF', fontWeight: '700' }}>&#10003;</Text>}
                  </TouchableOpacity>
                ))}
                {filtered.length === 0 && !canAdd && <Text style={sel.noResult}>No results</Text>}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── PDF Builder ────────────────────────────────────────────────────────────────
function buildDecorHTML(e: DecorEntry): string {
  const total = decorTotal(e);
  const bal   = calcBalance(e);
  const TD  = 'padding:8px 12px;font-size:12px;color:#333;border-bottom:1px solid #ebebeb;';
  const TDR = TD + 'text-align:right;';
  const TH  = 'padding:7px 12px;font-size:11px;font-weight:700;color:#555;background:#f5f5f5;text-align:left;';
  const THR = TH + 'text-align:right;';

  const itemRows = e.decorItems.map(i =>
    `<tr><td style="${TD}">${i.name}</td><td style="${TDR}">${i.quantity}</td><td style="${TDR}">${fmtMoney(i.costPerUnit)}</td><td style="${TDR}font-weight:600;">${fmtMoney(i.quantity * i.costPerUnit)}</td></tr>`
  ).join('');

  const reqRows = e.requiredItems.map(r =>
    `<tr><td style="${TD}">${r.name}</td><td style="${TDR}">${r.quantity}</td><td style="${TD}">${r.description || '&mdash;'}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>body{margin:0;padding:24px;font-family:Arial,sans-serif;font-size:13px;color:#222;background:#fff;}table{width:100%;border-collapse:collapse;}</style>
</head><body>
<table style="margin-bottom:16px;"><tr>
  <td><p style="margin:0;font-size:22px;font-weight:700;color:#111;">A1 Groups</p><p style="margin:4px 0 0;font-size:11px;color:#888;">Decor Management</p></td>
  <td style="text-align:right;"><p style="margin:0;font-size:18px;font-weight:700;">DECOR ESTIMATE</p><p style="margin:4px 0 0;font-size:11px;color:#888;">Date: ${fmtDate(e.createdDate)}</p></td>
</tr></table>
<hr style="border:none;border-top:2px solid #222;margin:0 0 14px;"/>
<table style="margin-bottom:14px;"><tr>
  <td style="width:50%;vertical-align:top;padding-right:12px;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:0 0 6px;">Customer</p>
    <table style="border:1px solid #ddd;">
      <tr><td style="${TD}color:#888;">Name</td><td style="${TDR}font-weight:600;">${e.customerName}</td></tr>
      <tr><td style="${TD}color:#888;">Mobile</td><td style="${TDR}">${e.mobile}</td></tr>
      <tr><td style="${TD}color:#888;">Event</td><td style="${TDR}">${e.eventName}</td></tr>
    </table>
  </td>
  <td style="width:50%;vertical-align:top;padding-left:12px;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:0 0 6px;">Event Details</p>
    <table style="border:1px solid #ddd;">
      <tr><td style="${TD}color:#888;">Type</td><td style="${TDR}font-weight:600;">${e.eventType}</td></tr>
      <tr><td style="${TD}color:#888;">Date</td><td style="${TDR}">${fmtDate(e.eventDate)}</td></tr>
      <tr><td style="${TD}color:#888;">Location</td><td style="${TDR}">${e.location || '&mdash;'}</td></tr>
    </table>
  </td>
</tr></table>
<p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:14px 0 6px;">Decor Items</p>
<table style="border:1px solid #ddd;">
  <tr><th style="${TH}">Item</th><th style="${THR}">Qty</th><th style="${THR}">Rate</th><th style="${THR}">Amount</th></tr>
  ${itemRows}
  <tr><td colspan="3" style="padding:9px 12px;font-size:13px;font-weight:700;background:#f5f5f5;border-top:2px solid #ddd;">Total Decor Cost</td>
      <td style="padding:9px 12px;font-size:13px;font-weight:700;text-align:right;background:#f5f5f5;border-top:2px solid #ddd;">${fmtMoney(total)}</td></tr>
</table>
<p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:14px 0 6px;">Payment</p>
<table style="border:1px solid #ddd;">
  <tr><td style="${TD}color:#888;">Advance Paid</td><td style="${TDR}">${fmtMoney(e.advanceAmount)}</td></tr>
  <tr><td style="${TD}color:#888;">Amount Settled</td><td style="${TDR}">${fmtMoney(e.settledAmount)}</td></tr>
  <tr style="background:${bal > 0 ? '#fff2f2' : '#f2fff5'};"><td style="padding:10px 12px;font-size:14px;font-weight:700;color:${bal > 0 ? '#c0392b' : '#1e8449'};">${bal > 0 ? 'Balance Due' : 'Fully Paid'}</td>
  <td style="padding:10px 12px;font-size:14px;font-weight:700;text-align:right;color:${bal > 0 ? '#c0392b' : '#1e8449'};">${fmtMoney(bal)}</td></tr>
</table>
${reqRows ? `<p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#555;margin:14px 0 6px;">Items Required</p>
<table style="border:1px solid #ddd;"><tr><th style="${TH}">Item</th><th style="${THR}">Qty</th><th style="${TH}">Description</th></tr>${reqRows}</table>` : ''}
${e.comments ? `<p style="margin:14px 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;color:#555;">Notes</p><p style="border:1px solid #ddd;padding:10px;border-radius:4px;font-size:12px;color:#444;">${e.comments}</p>` : ''}
<table style="margin-top:24px;border-top:1px solid #ccc;padding-top:8px;"><tr>
  <td style="font-size:10px;color:#999;">A1 Groups &middot; Decor Management</td>
  <td style="font-size:10px;color:#bbb;text-align:right;">Generated ${fmtDate(nowDate())}</td>
</tr></table>
</body></html>`;
}

async function printDecorEntry(e: DecorEntry) {
  const html = buildDecorHTML(e);
  try {
    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
    } else {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Decor PDF' });
      else await Print.printAsync({ html });
    }
  } catch (err: any) { Alert.alert('Error', err?.message ?? 'Could not generate PDF.'); }
}

// ── Decor Card ─────────────────────────────────────────────────────────────────
function DecorCard({ entry, onView, onEdit, onPrint, onDelete }: {
  entry: DecorEntry;
  onView: () => void; onEdit: () => void; onPrint: () => void; onDelete: () => void;
}) {
  const internalCost = decorTotal(entry);
  const total        = effectiveTotal(entry);
  const bal          = calcBalance(entry);
  const upcoming     = isUpcoming(entry);

  return (
    <View style={dc.card}>
      <View style={dc.topRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
            <Text style={dc.eventName}>{entry.eventName}</Text>
            {entry.eventType ? (
              <View style={dc.typeBadge}>
                <Text style={dc.typeBadgeTxt}>{entry.eventType}</Text>
              </View>
            ) : null}
          </View>
          <Text style={dc.customer}>{entry.customerName}  ·  {entry.mobile}</Text>
        </View>
        <View style={[dc.statusBadge, { backgroundColor: PAY_COLOR[entry.paymentStatus] + '22' }]}>
          <Text style={[dc.statusTxt, { color: PAY_COLOR[entry.paymentStatus] }]}>{PAY_LABEL[entry.paymentStatus]}</Text>
        </View>
      </View>

      {entry.images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={dc.imgRow}>
          {entry.images.slice(0, 5).map((uri, i) => (
            <Image key={i} source={{ uri }} style={dc.thumb} resizeMode="contain" />
          ))}
        </ScrollView>
      )}

      <View style={dc.metaRow}>
        <Text style={dc.meta}>&#128197; {fmtDate(entry.eventDate)}</Text>
        {entry.location ? <Text style={dc.meta}>&#128205; {entry.location}</Text> : null}
        {upcoming && (
          <View style={dc.upcomingChip}>
            <Text style={dc.upcomingTxt}>Upcoming</Text>
          </View>
        )}
      </View>

      <View style={dc.finRow}>
        <View style={dc.finItem}>
          <Text style={dc.finLabel}>{entry.quotedAmount > 0 ? 'Quoted' : 'Our Cost'}</Text>
          <Text style={[dc.finVal, entry.quotedAmount > 0 && { color: '#7B61FF' }]}>{fmtMoney(total)}</Text>
          {entry.quotedAmount > 0 && <Text style={{ fontSize: 10, color: '#9B98C0', marginTop: 1 }}>Cost: {fmtMoney(internalCost)}</Text>}
        </View>
        <View style={dc.finItem}>
          <Text style={dc.finLabel}>Paid</Text>
          <Text style={[dc.finVal, { color: '#27ae60' }]}>{fmtMoney(entry.advanceAmount + entry.settledAmount)}</Text>
        </View>
        <View style={dc.finItem}>
          <Text style={dc.finLabel}>Balance</Text>
          <Text style={[dc.finVal, { color: bal > 0 ? '#e74c3c' : '#27ae60' }]}>{fmtMoney(bal)}</Text>
        </View>
        <View style={dc.finItem}>
          <Text style={dc.finLabel}>Items</Text>
          <Text style={dc.finVal}>{entry.decorItems.length}</Text>
        </View>
      </View>

      <View style={dc.actionRow}>
        <TouchableOpacity style={[dc.btn, { backgroundColor: 'rgba(123,97,255,0.13)' }]} onPress={onView}>
          <Text style={[dc.btnTxt, { color: '#7B61FF' }]}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[dc.btn, { backgroundColor: '#2980b922' }]} onPress={onEdit}>
          <Text style={[dc.btnTxt, { color: '#2980b9' }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[dc.btn, { backgroundColor: '#8e44ad22' }]} onPress={onPrint}>
          <Text style={[dc.btnTxt, { color: '#8e44ad' }]}>Print</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[dc.btn, { backgroundColor: '#e74c3c22' }]} onPress={onDelete}>
          <Text style={[dc.btnTxt, { color: '#e74c3c' }]}>Delete</Text>
        </TouchableOpacity>
      </View>

      <Text style={dc.createdDate}>Created {fmtDate(entry.createdDate)}</Text>
    </View>
  );
}

// ── Decor Detail Modal ─────────────────────────────────────────────────────────
function DecorDetailModal({ entry: init, isNew = false, onClose, onCreate, onUpdate, decorItemOptions, onAddDecorItem }: {
  entry: DecorEntry; isNew?: boolean;
  onClose: () => void;
  onCreate?: (e: DecorEntry) => Promise<void>;
  onUpdate?: (e: DecorEntry) => Promise<void>;
  decorItemOptions: string[];
  onAddDecorItem: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [entry, setEntry]         = useState<DecorEntry>(init);
  const [isEditing, setIsEditing] = useState(isNew);
  const [fullImgIdx, setFullImgIdx] = useState<number | null>(null);
  const [activeImg, setActiveImg]   = useState(0);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [bookings, setBookings]   = useState<BookingDoc[]>([]);
  const [showBookingPicker, setShowBookingPicker] = useState(false);
  const [bookingSearch, setBookingSearch]         = useState('');

  // Load bookings once for the link picker
  useEffect(() => {
    bookingsApi.getAll().then(setBookings).catch(() => {});
  }, []);

  function upd(patch: Partial<DecorEntry>) { setEntry(e => ({ ...e, ...patch })); }

  const linkedBooking = bookings.find(b => b._id === entry.bookingId);

  async function pickImages() {
    if (!ImagePicker) return Alert.alert('Not available', 'Image picker is not available on this platform.');
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Permission needed', 'Allow photo library access to add images.');
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true, quality: 0.7,
      });
      if (!result.canceled) {
        setUploading(true);
        try {
          const urls = await Promise.all(result.assets.map((a: any) => uploadApi.uploadImage(a.uri)));
          upd({ images: [...entry.images, ...urls] });
        } catch (e: any) { console.error('Upload error:', e); Alert.alert('Upload failed', e.message); }
        finally { setUploading(false); }
      }
    } catch { Alert.alert('Error', 'Could not open image picker.'); }
  }

  function removeImage(idx: number) { upd({ images: entry.images.filter((_, i) => i !== idx) }); }

  function addDecorItem() { upd({ decorItems: [...entry.decorItems, { id: uid(), name: '', quantity: 1, costPerUnit: 0 }] }); }
  function updateDecorItem(id: string, patch: Partial<DecorItem>) {
    upd({ decorItems: entry.decorItems.map(i => i.id === id ? { ...i, ...patch } : i) });
  }
  function removeDecorItem(id: string) { upd({ decorItems: entry.decorItems.filter(i => i.id !== id) }); }

  function addRequiredItem() { upd({ requiredItems: [...entry.requiredItems, { id: uid(), name: '', quantity: 1, description: '' }] }); }
  function updateRequiredItem(id: string, patch: Partial<RequiredItem>) {
    upd({ requiredItems: entry.requiredItems.map(r => r.id === id ? { ...r, ...patch } : r) });
  }
  function removeRequiredItem(id: string) { upd({ requiredItems: entry.requiredItems.filter(r => r.id !== id) }); }

  async function handleSave() {
    if (!entry.eventName.trim())    return Alert.alert('Required', 'Enter event name.');
    if (!entry.customerName.trim()) return Alert.alert('Required', 'Enter customer name.');
    if (!entry.mobile.trim())       return Alert.alert('Required', 'Enter mobile number.');
    const final = { ...entry, paymentStatus: autoStatus(entry) };
    setSaving(true);
    try {
      if (isNew) { await onCreate?.(final); onClose(); }
      else       { await onUpdate?.(final); setIsEditing(false); }
    } catch (e: any) { console.error('Save error:', e); Alert.alert('Error', e.message ?? String(e)); }
    finally { setSaving(false); }
  }

  function handleCancel() {
    if (isNew) { onClose(); }
    else { setEntry(init); setIsEditing(false); }
  }

  const total = decorTotal(entry);
  const bal   = calcBalance(entry);

  const [copiedSection, setCopiedSection] = useState<'decor' | 'required' | null>(null);

  function copyDecorItems() {
    const lines = entry.decorItems
      .filter(i => i.name)
      .map(i => `• ${i.name} - ${i.quantity} - ${fmtMoney(i.costPerUnit)} each = ${fmtMoney(i.quantity * i.costPerUnit)}`)
      .join('\n');
    Clipboard.setStringAsync(`Decor Items (${entry.decorItems.length}):\n${lines}\n\nTotal: ${fmtMoney(total)}`);
    setCopiedSection('decor');
    setTimeout(() => setCopiedSection(null), 2000);
  }

  function copyRequiredItems() {
    const lines = entry.requiredItems
      .filter(r => r.name)
      .map(r => `• ${r.name} - ${r.quantity}${r.description ? ' — ' + r.description : ''}`)
      .join('\n');
    Clipboard.setStringAsync(`Items Required (${entry.requiredItems.length}):\n${lines}`);
    setCopiedSection('required');
    setTimeout(() => setCopiedSection(null), 2000);
  }

  return (
    <Modal transparent={false} statusBarTranslucent animationType="slide" onRequestClose={isNew ? onClose : onClose}>
      <View style={{ flex: 1, backgroundColor: '#EEF0FF' }}>

        {/* Navbar */}
        <View style={[dmod.navbar, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={isEditing ? handleCancel : onClose} style={dmod.navBack}>
            <Text style={dmod.navBackTxt}>{isEditing ? 'Cancel' : '&#8592; Back'}</Text>
          </TouchableOpacity>
          <Text style={dmod.navTitle} numberOfLines={1}>{isNew ? 'New Decor' : entry.eventName}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!isEditing && (
              <TouchableOpacity style={dmod.navIconBtn} onPress={() => printDecorEntry(entry)}>
                <Text style={dmod.navIconTxt}>Print</Text>
              </TouchableOpacity>
            )}
            {isEditing ? (
              <TouchableOpacity style={dmod.navSave} onPress={handleSave} disabled={saving || uploading}>
                <Text style={dmod.navSaveTxt}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={dmod.navEdit} onPress={() => setIsEditing(true)}>
                <Text style={dmod.navEditTxt}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Status banner — view mode only */}
            {!isEditing && (
              <View style={[dmod.statusBanner, { backgroundColor: PAY_COLOR[entry.paymentStatus] + '18', borderColor: PAY_COLOR[entry.paymentStatus] + '50' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[dmod.statusTitle, { color: PAY_COLOR[entry.paymentStatus] }]}>
                    {PAY_LABEL[entry.paymentStatus]} Payment
                  </Text>
                  <Text style={dmod.statusSub}>
                    {entry.eventType}{entry.eventType && entry.eventDate ? '  ·  ' : ''}{fmtDate(entry.eventDate)}{entry.location ? '  ·  ' + entry.location : ''}
                  </Text>
                </View>
                <View style={[dmod.statusDot, { backgroundColor: PAY_COLOR[entry.paymentStatus] }]} />
              </View>
            )}

            {/* ── Image Gallery ── */}
            <View style={dmod.section}>
              <Text style={dmod.sectionTitle}>
                Images {entry.images.length > 0 ? `(${entry.images.length})` : ''}
              </Text>

              {/* View mode — full-width carousel */}
              {!isEditing && entry.images.length > 0 && (
                <View>
                  <ScrollView
                    horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                    style={{ width: SW - 32 }}
                    onMomentumScrollEnd={e => {
                      setActiveImg(Math.round(e.nativeEvent.contentOffset.x / (SW - 32)));
                    }}
                  >
                    {entry.images.map((uri, i) => (
                      <TouchableOpacity key={i} activeOpacity={0.92} onPress={() => setFullImgIdx(i)}>
                        <Image source={{ uri }} style={dmod.carouselImg} resizeMode="contain" />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {entry.images.length > 1 && (
                    <View style={dmod.dotsRow}>
                      {entry.images.map((_, i) => (
                        <View key={i} style={[dmod.dot, i === activeImg && dmod.dotActive]} />
                      ))}
                    </View>
                  )}
                </View>
              )}

              {!isEditing && entry.images.length === 0 && (
                <Text style={dmod.hint}>No images added.</Text>
              )}

              {/* Edit mode — thumbnail row with add button */}
              {isEditing && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {entry.images.map((uri, i) => (
                    <View key={i} style={dmod.imgWrap}>
                      <TouchableOpacity onPress={() => setFullImgIdx(i)} activeOpacity={0.85}>
                        <Image source={{ uri }} style={dmod.imgThumb} resizeMode="contain" />
                      </TouchableOpacity>
                      <TouchableOpacity style={dmod.imgRemove} onPress={() => removeImage(i)}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={dmod.imgAddBtn} onPress={pickImages} disabled={uploading}>
                    <Text style={dmod.imgAddPlus}>{uploading ? '…' : '+'}</Text>
                    <Text style={dmod.imgAddLabel}>{uploading ? 'Uploading…' : 'Add Photos'}</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>

            {/* ── Event Information ── */}
            <View style={dmod.section}>
              <Text style={dmod.sectionTitle}>Event Information</Text>
              {isEditing ? (
                <>
                  <Text style={dmod.label}>Event Name *</Text>
                  <TextInput style={dmod.input} placeholder="e.g. Sharma Wedding" value={entry.eventName} onChangeText={v => upd({ eventName: v })} />

                  <Text style={dmod.label}>Event Type</Text>
                  <SelectField value={entry.eventType} options={EVENT_TYPES} onChange={v => upd({ eventType: v })} placeholder="Select event type" />

                  <Text style={dmod.label}>Customer Name *</Text>
                  <TextInput style={dmod.input} placeholder="e.g. Ravi Sharma" value={entry.customerName} onChangeText={v => upd({ customerName: v })} />

                  <Text style={dmod.label}>Mobile Number *</Text>
                  <TextInput style={dmod.input} placeholder="10-digit mobile" keyboardType="phone-pad" value={entry.mobile} onChangeText={v => upd({ mobile: v })} maxLength={10} />

                  <Text style={dmod.label}>Event Date</Text>
                  <DatePickerField value={entry.eventDate} onChange={v => upd({ eventDate: v })} />

                  <Text style={dmod.label}>Location</Text>
                  <TextInput style={dmod.input} placeholder="e.g. A1 Function Hall" value={entry.location} onChangeText={v => upd({ location: v })} />

                  {/* ── Link to Booking (optional) ── */}
                  <Text style={dmod.label}>Link to Venue Booking <Text style={{ color: '#9B98C0', fontWeight: '400' }}>(Optional)</Text></Text>
                  {linkedBooking ? (
                    <View style={dmod.linkedBookingCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={dmod.linkedBookingTitle} numberOfLines={1}>
                          {linkedBooking.venue}  ·  {linkedBooking.date}
                        </Text>
                        <Text style={dmod.linkedBookingSub} numberOfLines={1}>
                          {linkedBooking.client}  —  {linkedBooking.eventName}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => upd({ bookingId: null })} style={dmod.clearLinkBtn}>
                        <Text style={dmod.clearLinkTxt}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={dmod.linkBookingBtn} onPress={() => { setBookingSearch(''); setShowBookingPicker(true); }}>
                      <Text style={dmod.linkBookingTxt}>🔗  Select a Booking…</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <View style={dmod.infoTable}>
                  {([
                    ['Customer',  entry.customerName],
                    ['Mobile',    entry.mobile],
                    ['Event Type',entry.eventType || '—'],
                    ['Date',      fmtDate(entry.eventDate)],
                    ['Location',  entry.location || '—'],
                    ['Created',   fmtDate(entry.createdDate)],
                  ] as [string, string][]).map(([k, v]) => (
                    <View key={k} style={dmod.infoRow}>
                      <Text style={dmod.infoKey}>{k}</Text>
                      <Text style={dmod.infoVal}>{v}</Text>
                    </View>
                  ))}
                  {linkedBooking && (
                    <View style={[dmod.infoRow, { backgroundColor: 'rgba(123,97,255,0.06)', borderRadius: 8, marginTop: 4, paddingHorizontal: 8 }]}>
                      <Text style={dmod.infoKey}>Linked Booking</Text>
                      <View style={{ flex: 2, alignItems: 'flex-end' }}>
                        <Text style={[dmod.infoVal, { color: '#7B61FF', fontWeight: '700' }]} numberOfLines={1}>
                          {linkedBooking.venue}
                        </Text>
                        <Text style={[dmod.infoVal, { fontSize: 11, color: '#9B98C0' }]} numberOfLines={1}>
                          {linkedBooking.date}  ·  {linkedBooking.client}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* ── Decor Items ── */}
            <View style={dmod.section}>
              <View style={dmod.sectionHeader}>
                <Text style={dmod.sectionTitle}>Decor Items</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {entry.decorItems.length > 0 && (
                    <TouchableOpacity style={dmod.copyBtn} onPress={copyDecorItems}>
                      <Text style={dmod.copyBtnTxt}>{copiedSection === 'decor' ? '✓ Coiiipied' : 'Copy'}</Text>
                    </TouchableOpacity>
                  )}
                  {isEditing && (
                    <TouchableOpacity style={dmod.addRowBtn} onPress={addDecorItem}>
                      <Text style={dmod.addRowTxt}>+ Add Item</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {entry.decorItems.length === 0 ? (
                <Text style={dmod.hint}>{isEditing ? 'Tap "+ Add Item" to add decor items.' : 'No decor items added.'}</Text>
              ) : (
                <>
                  <View style={dmod.tableHead}>
                    <Text style={[dmod.thCell, { flex: 3 }]}>Item</Text>
                    <Text style={[dmod.thCell, { flex: 1, textAlign: 'right' }]}>Qty</Text>
                    <Text style={[dmod.thCell, { flex: 2, textAlign: 'right' }]}>Rate</Text>
                    <Text style={[dmod.thCell, { flex: 2, textAlign: 'right' }]}>Total</Text>
                    {isEditing && <View style={{ width: 30 }} />}
                  </View>

                  {entry.decorItems.map((item, idx) => (
                    <View key={item.id} style={[dmod.tableRow, idx % 2 === 1 && { backgroundColor: '#f8f9ff' }]}>
                      {isEditing ? (
                        <>
                          <View style={{ flex: 3 }}>
                            <SelectField value={item.name} options={decorItemOptions}
                              onChange={v => updateDecorItem(item.id, { name: v })}
                              placeholder="Select" style={dmod.cellInput}
                              allowCustom onAddCustom={onAddDecorItem} />
                          </View>
                          <TextInput style={[dmod.cellInput, { flex: 1, textAlign: 'right' }]}
                            keyboardType="number-pad" value={item.quantity > 0 ? item.quantity.toString() : ''}
                            onChangeText={v => updateDecorItem(item.id, { quantity: Number(v) || 0 })} />
                          <TextInput style={[dmod.cellInput, { flex: 2, textAlign: 'right' }]}
                            keyboardType="number-pad" value={item.costPerUnit > 0 ? item.costPerUnit.toString() : ''}
                            onChangeText={v => updateDecorItem(item.id, { costPerUnit: Number(v) || 0 })} />
                          <Text style={[dmod.tdCell, { flex: 2, textAlign: 'right', fontWeight: '700', color: '#1A1A2E' }]}>
                            {fmtMoney(item.quantity * item.costPerUnit)}
                          </Text>
                          <TouchableOpacity onPress={() => removeDecorItem(item.id)} style={{ width: 30, alignItems: 'center' }}>
                            <Text style={{ color: '#e74c3c', fontSize: 16, fontWeight: '700' }}>x</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <Text style={[dmod.tdCell, { flex: 3 }]}>{item.name || '—'}</Text>
                          <Text style={[dmod.tdCell, { flex: 1, textAlign: 'right' }]}>{item.quantity}</Text>
                          <Text style={[dmod.tdCell, { flex: 2, textAlign: 'right' }]}>{fmtMoney(item.costPerUnit)}</Text>
                          <Text style={[dmod.tdCell, { flex: 2, textAlign: 'right', fontWeight: '700', color: '#1A1A2E' }]}>
                            {fmtMoney(item.quantity * item.costPerUnit)}
                          </Text>
                        </>
                      )}
                    </View>
                  ))}

                  <View style={dmod.totalBar}>
                    <Text style={dmod.totalBarLabel}>Total Decor Cost</Text>
                    <Text style={dmod.totalBarVal}>{fmtMoney(total)}</Text>
                  </View>
                </>
              )}
            </View>

            {/* ── Payment ── */}
            <View style={dmod.section}>
              <Text style={dmod.sectionTitle}>Payment</Text>

              {isEditing ? (
                <>
                  {/* Decor Quoted — customer-facing price finalised */}
                  <View style={dmod.quotedBox}>
                    <Text style={dmod.quotedLabel}>
                      Decor Quoted  <Text style={{ fontWeight: '400', fontSize: 11, color: '#9B98C0' }}>(Finalised with Customer)</Text>
                    </Text>
                    <TextInput
                      style={dmod.quotedInput}
                      keyboardType="number-pad"
                      placeholder="Enter quoted amount"
                      placeholderTextColor="#9B98C0"
                      value={entry.quotedAmount > 0 ? entry.quotedAmount.toString() : ''}
                      onChangeText={v => upd({ quotedAmount: Number(v) || 0 })}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={dmod.label}>Advance Amount (Rs.)</Text>
                      <TextInput style={dmod.input} keyboardType="number-pad" placeholder="0"
                        value={entry.advanceAmount > 0 ? entry.advanceAmount.toString() : ''}
                        onChangeText={v => upd({ advanceAmount: Number(v) || 0 })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={dmod.label}>Amount Settled (Rs.)</Text>
                      <TextInput style={dmod.input} keyboardType="number-pad" placeholder="0"
                        value={entry.settledAmount > 0 ? entry.settledAmount.toString() : ''}
                        onChangeText={v => upd({ settledAmount: Number(v) || 0 })} />
                    </View>
                  </View>
                  <View style={dmod.calcBox}>
                    {entry.quotedAmount > 0 && (
                      <View style={dmod.calcRow}>
                        <Text style={dmod.calcLabel}>Quoted to Customer</Text>
                        <Text style={[dmod.calcVal, { color: '#7B61FF', fontWeight: '700' }]}>{fmtMoney(entry.quotedAmount)}</Text>
                      </View>
                    )}
                    <View style={dmod.calcRow}>
                      <Text style={dmod.calcLabel}>Our Internal Cost</Text>
                      <Text style={dmod.calcVal}>{fmtMoney(total)}</Text>
                    </View>
                    {entry.quotedAmount > 0 && (
                      <View style={dmod.calcRow}>
                        <Text style={dmod.calcLabel}>Profit / Margin</Text>
                        <Text style={[dmod.calcVal, { color: entry.quotedAmount >= total ? '#27ae60' : '#e74c3c', fontWeight: '700' }]}>
                          {fmtMoney(entry.quotedAmount - total)}
                        </Text>
                      </View>
                    )}
                    <View style={dmod.calcRow}>
                      <Text style={dmod.calcLabel}>Total Paid by Customer</Text>
                      <Text style={[dmod.calcVal, { color: '#27ae60' }]}>- {fmtMoney(entry.advanceAmount + entry.settledAmount)}</Text>
                    </View>
                    <View style={[dmod.calcRow, dmod.calcTotalRow]}>
                      <Text style={[dmod.calcLabel, { fontWeight: '700', color: '#1A1A2E' }]}>Remaining Balance</Text>
                      <Text style={[dmod.calcVal, { fontWeight: '800', fontSize: 16, color: bal > 0 ? '#e74c3c' : '#27ae60' }]}>{fmtMoney(bal)}</Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={dmod.payGrid}>
                  {([
                    ...(entry.quotedAmount > 0 ? [['Quoted', fmtMoney(entry.quotedAmount), '#7B61FF']] : []),
                    ['Our Cost',  fmtMoney(total),                          '#1A1A2E'],
                    ...(entry.quotedAmount > 0 ? [['Margin', fmtMoney(entry.quotedAmount - total), entry.quotedAmount >= total ? '#27ae60' : '#e74c3c']] : []),
                    ['Advance',     fmtMoney(entry.advanceAmount),             '#27ae60'],
                    ['Settled',     fmtMoney(entry.settledAmount),             '#27ae60'],
                    ['Balance',     fmtMoney(bal), bal > 0 ? '#e74c3c' : '#27ae60'],
                  ] as [string, string, string][]).map(([label, val, color]) => (
                    <View key={label} style={dmod.payGridItem}>
                      <Text style={dmod.payGridLabel}>{label}</Text>
                      <Text style={[dmod.payGridVal, { color }]}>{val}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={[dmod.statusPill, { backgroundColor: PAY_COLOR[entry.paymentStatus] + '18', borderColor: PAY_COLOR[entry.paymentStatus] + '50' }]}>
                <Text style={[dmod.statusPillTxt, { color: PAY_COLOR[entry.paymentStatus] }]}>
                  {PAY_LABEL[entry.paymentStatus]}  —  {bal > 0 ? `${fmtMoney(bal)} remaining` : 'Fully paid'}
                </Text>
              </View>
            </View>

            {/* ── Items Required ── */}
            <View style={dmod.section}>
              <View style={dmod.sectionHeader}>
                <Text style={dmod.sectionTitle}>Items Required</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {entry.requiredItems.length > 0 && (
                    <TouchableOpacity style={dmod.copyBtn} onPress={copyRequiredItems}>
                      <Text style={dmod.copyBtnTxt}>{copiedSection === 'required' ? '✓ Copied' : 'Copy'}</Text>
                    </TouchableOpacity>
                  )}
                  {isEditing && (
                    <TouchableOpacity style={dmod.addRowBtn} onPress={addRequiredItem}>
                      <Text style={dmod.addRowTxt}>+ Add Row</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {entry.requiredItems.length === 0 ? (
                <Text style={dmod.hint}>{isEditing ? 'Tap "+ Add Row" to list required items.' : 'No items listed.'}</Text>
              ) : (
                entry.requiredItems.map((r, idx) => (
                  <View key={r.id} style={[dmod.reqRow, idx % 2 === 1 && { backgroundColor: '#f8f9ff' }]}>
                    {isEditing ? (
                      <>
                        <View style={{ flex: 2 }}>
                          <SelectField value={r.name} options={decorItemOptions}
                            onChange={v => updateRequiredItem(r.id, { name: v })}
                            placeholder="Select item" style={dmod.cellInput}
                            allowCustom onAddCustom={onAddDecorItem} />
                        </View>
                        <TextInput style={[dmod.cellInput, { flex: 1 }]}
                          keyboardType="number-pad" placeholder="Qty"
                          value={r.quantity > 0 ? r.quantity.toString() : ''}
                          onChangeText={v => updateRequiredItem(r.id, { quantity: Number(v) || 0 })} />
                        <TextInput style={[dmod.cellInput, { flex: 2 }]}
                          placeholder="Description" value={r.description}
                          onChangeText={v => updateRequiredItem(r.id, { description: v })} />
                        <TouchableOpacity onPress={() => removeRequiredItem(r.id)} style={{ width: 30, alignItems: 'center' }}>
                          <Text style={{ color: '#e74c3c', fontSize: 16, fontWeight: '700' }}>x</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <Text style={[dmod.tdCell, { flex: 2, fontWeight: '600' }]}>{r.name || '—'}</Text>
                        <Text style={[dmod.tdCell, { flex: 1, color: '#9B98C0' }]}>x{r.quantity}</Text>
                        <Text style={[dmod.tdCell, { flex: 2, color: '#9B98C0' }]}>{r.description || '—'}</Text>
                      </>
                    )}
                  </View>
                ))
              )}
            </View>

            {/* ── Comments ── */}
            <View style={dmod.section}>
              <Text style={dmod.sectionTitle}>Notes & Comments</Text>
              {isEditing ? (
                <TextInput style={[dmod.input, { height: 110, textAlignVertical: 'top', paddingTop: 12 }]}
                  placeholder="Add notes, special requirements, or instructions..."
                  multiline value={entry.comments}
                  onChangeText={v => upd({ comments: v })} />
              ) : entry.comments ? (
                <Text style={dmod.commentsBox}>{entry.comments}</Text>
              ) : (
                <Text style={dmod.hint}>No notes added.</Text>
              )}
            </View>

            {/* Bottom action buttons */}
            {isEditing && (
              <View style={dmod.bottomRow}>
                <TouchableOpacity style={dmod.cancelBtn} onPress={handleCancel} disabled={saving}>
                  <Text style={dmod.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={dmod.saveBtn} onPress={handleSave} disabled={saving || uploading}>
                  <Text style={dmod.saveBtnTxt}>{saving ? 'Saving…' : isNew ? 'Create Decor' : 'Save Changes'}</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 50 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {/* Booking picker modal */}
      <Modal visible={showBookingPicker} transparent statusBarTranslucent animationType="slide" onRequestClose={() => setShowBookingPicker(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: '#00000060' }} activeOpacity={1} onPress={() => setShowBookingPicker(false)}>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', padding: 16 }}
            onStartShouldSetResponder={() => true}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginBottom: 12 }}>Select a Booking</Text>
            <TextInput
              style={{ backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', padding: 10, marginBottom: 10, fontSize: 14, color: '#1A1A2E' }}
              placeholder="Search client, venue, event…" placeholderTextColor="#9B98C0"
              value={bookingSearch} onChangeText={setBookingSearch} autoFocus
            />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {bookings
                .filter(b => {
                  const q = bookingSearch.toLowerCase();
                  return !q || b.client.toLowerCase().includes(q) || b.venue.toLowerCase().includes(q) || b.eventName.toLowerCase().includes(q) || b.date.includes(q);
                })
                .map(b => (
                  <TouchableOpacity
                    key={b._id}
                    style={{ padding: 12, borderRadius: 10, marginBottom: 6, backgroundColor: entry.bookingId === b._id ? 'rgba(123,97,255,0.07)' : '#F7F5FF', borderWidth: 1, borderColor: entry.bookingId === b._id ? 'rgba(123,97,255,0.3)' : 'rgba(123,97,255,0.1)' }}
                    onPress={() => { upd({ bookingId: b._id }); setShowBookingPicker(false); }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A2E' }}>{b.venue}  ·  {b.date}</Text>
                    <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{b.client}  —  {b.eventName}</Text>
                  </TouchableOpacity>
                ))
              }
              {bookings.length === 0 && <Text style={{ color: '#9B98C0', textAlign: 'center', padding: 24 }}>No bookings found</Text>}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full-screen viewer */}
      {fullImgIdx !== null && (
        <ImageViewer
          images={entry.images}
          initialIndex={fullImgIdx}
          onClose={() => setFullImgIdx(null)}
        />
      )}
    </Modal>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function DecorScreen() {
  const [entries,         setEntries]         = useState<DecorEntry[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [search,          setSearch]          = useState('');
  const [filterType,      setFilterType]      = useState('All');
  const [filterStatus,    setFilterStatus]    = useState<PaymentStatus | 'All'>('All');
  const [sortBy,          setSortBy]          = useState('Newest First');
  const [showSort,        setShowSort]        = useState(false);
  const [selected,        setSelected]        = useState<{ entry: DecorEntry; editing: boolean } | null>(null);
  const [showNew,         setShowNew]         = useState(false);
  const { items: decorItemOptions, addItem: onAddDecorItem, rawItems: decorRawItems, removeItem: removeDecorItem } = useDecorItems();
  const [showManageItems, setShowManageItems] = useState(false);

  const loadDecors = useCallback(async () => {
    try {
      const data = await decorsApi.getAll();
      setEntries(data.map(normalizeDecor));
    } catch (err: any) { Alert.alert('Error', err.message); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadDecors(); }, [loadDecors]));

  function newEntry(): DecorEntry {
    return {
      id: uid(), eventName: '', eventType: '', customerName: '', mobile: '',
      eventDate: '', location: '', images: [], decorItems: [], requiredItems: [],
      quotedAmount: 0, advanceAmount: 0, settledAmount: 0, paymentStatus: 'pending',
      comments: '', createdDate: nowDate(),
    };
  }

  async function handleCreate(e: DecorEntry) {
    const data = await decorsApi.create(toDecorPayload(e));
    setEntries(es => [normalizeDecor(data), ...es]);
  }

  async function handleUpdate(e: DecorEntry) {
    const data = await decorsApi.update(e.id, toDecorPayload(e));
    const updated = normalizeDecor(data);
    setEntries(es => es.map(x => x.id === e.id ? updated : x));
    setSelected(s => s ? { ...s, entry: updated } : null);
  }

  function handleDelete(id: string) {
    const doDelete = async () => {
      try {
        await decorsApi.remove(id);
        setEntries(es => es.filter(e => e.id !== id));
      } catch (err: any) { Alert.alert('Error', err.message); }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this decor entry?')) doDelete();
    } else {
      Alert.alert('Delete', 'Delete this decor entry?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EEF0FF' }}>
        <Text style={{ fontSize: 15, color: '#6E6E8D' }}>Loading decors…</Text>
      </View>
    );
  }

  let displayed = entries.filter(e => {
    const q = search.toLowerCase();
    const matchSearch  = !q || e.eventName.toLowerCase().includes(q) || e.customerName.toLowerCase().includes(q) || e.mobile.includes(q);
    const matchType    = filterType === 'All' || e.eventType === filterType;
    const matchStatus  = filterStatus === 'All' || e.paymentStatus === filterStatus;
    return matchSearch && matchType && matchStatus;
  });

  displayed = [...displayed].sort((a, b) => {
    if (sortBy === 'Newest First')       return b.createdDate.localeCompare(a.createdDate);
    if (sortBy === 'Oldest First')       return a.createdDate.localeCompare(b.createdDate);
    if (sortBy === 'Upcoming First')     return a.eventDate.localeCompare(b.eventDate);
    if (sortBy === 'Cost: High to Low')  return decorTotal(b) - decorTotal(a);
    if (sortBy === 'Cost: Low to High')  return decorTotal(a) - decorTotal(b);
    return 0;
  });

  const totalRevenue  = entries.reduce((s, e) => s + effectiveTotal(e), 0);
  const pendingBal    = entries.reduce((s, e) => s + calcBalance(e), 0);
  const upcomingCount = entries.filter(isUpcoming).length;

  return (
    <View style={main.container}>
      {/* Top bar */}
      <View style={main.topBar}>
        <Text style={main.topTitle}>Decor</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={main.manageBtn} onPress={() => setShowManageItems(true)}>
            <Text style={main.manageBtnTxt}>⚙ Items</Text>
          </TouchableOpacity>
          <TouchableOpacity style={main.addBtn} onPress={() => setShowNew(true)}>
            <Text style={main.addBtnTxt}>+ Add Decor</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>

        {/* Sticky search + filters */}
        <View style={main.stickyBar}>
          <View style={main.searchRow}>
            <TextInput style={main.searchInput} placeholder="Search by name, customer, mobile..."
              placeholderTextColor="#9B98C0" value={search} onChangeText={setSearch} />
            <TouchableOpacity style={main.sortBtn} onPress={() => setShowSort(true)}>
              <Text style={main.sortBtnTxt}>Sort</Text>
            </TouchableOpacity>
          </View>

          {/* Event type chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={main.chipScroll} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {(['All', ...EVENT_TYPES]).map(t => (
              <TouchableOpacity key={t} style={[main.chip, filterType === t && main.chipActive]} onPress={() => setFilterType(t)}>
                <Text style={[main.chipTxt, filterType === t && main.chipTxtActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Payment status chips */}
          <View style={main.statusRow}>
            {(['All', 'pending', 'partial', 'completed'] as const).map(s => {
              const active = filterStatus === s;
              const color  = s === 'All' ? '#7B61FF' : PAY_COLOR[s as PaymentStatus];
              return (
                <TouchableOpacity key={s} onPress={() => setFilterStatus(s)}
                  style={[main.statusChip, { backgroundColor: active ? color : color + '18', borderColor: active ? color : color + '40' }]}>
                  <Text style={[main.statusChipTxt, { color: active ? '#fff' : color }]}>
                    {s === 'All' ? 'All' : PAY_LABEL[s as PaymentStatus]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Summary cards */}
        <View style={main.summaryRow}>
          {([
            ['Total\nEvents',   entries.length.toString(), '#7B61FF'],
            ['Total\nRevenue',  fmtMoney(totalRevenue),    '#27ae60'],
            ['Pending\nBalance',fmtMoney(pendingBal),      '#e74c3c'],
            ['Upcoming\nEvents',upcomingCount.toString(),  '#2980b9'],
          ] as [string, string, string][]).map(([label, val, color]) => (
            <View key={label} style={[main.summaryCard, { borderTopColor: color }]}>
              <Text style={[main.summaryVal, { color }]}>{val}</Text>
              <Text style={main.summaryLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Results count */}
        <View style={main.resultsBar}>
          <Text style={main.resultsCount}>{displayed.length} result{displayed.length !== 1 ? 's' : ''}</Text>
          <Text style={main.sortedBy}>Sorted: {sortBy}</Text>
        </View>

        {/* Cards */}
        {displayed.length === 0 ? (
          <View style={main.empty}>
            <Text style={main.emptyIcon}>🎨</Text>
            <Text style={main.emptyTitle}>No decor entries found</Text>
            <Text style={main.emptyHint}>Adjust filters or tap "+ Add Decor" to create one.</Text>
          </View>
        ) : (
          displayed.map(e => (
            <DecorCard key={e.id} entry={e}
              onView={()   => setSelected({ entry: e, editing: false })}
              onEdit={()   => setSelected({ entry: e, editing: true  })}
              onPrint={()  => printDecorEntry(e)}
              onDelete={()  => handleDelete(e.id)}
            />
          ))
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Sort modal */}
      <Modal transparent statusBarTranslucent animationType="fade" visible={showSort} onRequestClose={() => setShowSort(false)}>
        <TouchableOpacity style={sel.overlay} onPress={() => setShowSort(false)} activeOpacity={1}>
          <View style={[sel.sheet, { width: SW * 0.8 }]}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#1A1A2E', marginBottom: 12 }}>Sort By</Text>
            {SORT_OPTIONS.map(o => (
              <TouchableOpacity key={o} style={[sel.option, sortBy === o && sel.optionActive]}
                onPress={() => { setSortBy(o); setShowSort(false); }}>
                <Text style={[sel.optionTxt, sortBy === o && sel.optionActiveTxt]}>{o}</Text>
                {sortBy === o && <Text style={{ color: '#7B61FF', fontWeight: '700' }}>&#10003;</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* View / Edit detail modal */}
      {selected && (
        <DecorDetailModal
          key={selected.entry.id + (selected.editing ? '-edit' : '-view')}
          entry={selected.entry}
          isNew={false}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          decorItemOptions={decorItemOptions}
          onAddDecorItem={onAddDecorItem}
        />
      )}

      {/* New decor modal */}
      {showNew && (
        <DecorDetailModal
          entry={newEntry()} isNew
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
          decorItemOptions={decorItemOptions}
          onAddDecorItem={onAddDecorItem}
        />
      )}

      <ManageDecorItemsModal
        visible={showManageItems}
        onClose={() => setShowManageItems(false)}
        rawItems={decorRawItems}
        onAdd={onAddDecorItem}
        onRemove={removeDecorItem}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const main = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#EEF0FF' },
  topBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 52, paddingBottom: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: 'rgba(123,97,255,0.12)' },
  topTitle:       { fontSize: 22, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.3 },
  addBtn:         { backgroundColor: '#7B61FF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22 },
  addBtnTxt:      { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.1 },
  manageBtn:      { backgroundColor: 'rgba(123,97,255,0.12)', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(123,97,255,0.25)' },
  manageBtnTxt:   { color: '#7B61FF', fontWeight: '700', fontSize: 13 },
  stickyBar:      { backgroundColor: '#EEF0FF', paddingTop: 12, paddingBottom: 4 },
  searchRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10, marginBottom: 10 },
  searchInput:    { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', paddingHorizontal: 16, paddingVertical: 11, fontSize: 14, color: '#1A1A2E' },
  sortBtn:        { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', paddingHorizontal: 16, paddingVertical: 11 },
  sortBtnTxt:     { fontSize: 13, fontWeight: '700', color: '#6E6E8D' },
  chipScroll:     { marginBottom: 10 },
  chip:           { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)', backgroundColor: '#FFFFFF' },
  chipActive:     { backgroundColor: '#7B61FF', borderColor: '#7B61FF' },
  chipTxt:        { fontSize: 12, fontWeight: '600', color: '#6E6E8D' },
  chipTxtActive:  { color: '#fff' },
  statusRow:      { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  statusChip:     { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
  statusChipTxt:  { fontSize: 12, fontWeight: '700' },
  summaryRow:     { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  summaryCard:    { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, alignItems: 'center', borderTopWidth: 3, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  summaryVal:     { fontSize: 14, fontWeight: '800', marginBottom: 3 },
  summaryLabel:   { fontSize: 9, color: '#9B98C0', fontWeight: '600', textAlign: 'center', letterSpacing: 0.2 },
  resultsBar:     { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  resultsCount:   { fontSize: 13, fontWeight: '700', color: '#6E6E8D' },
  sortedBy:       { fontSize: 11, color: '#9B98C0', fontWeight: '500' },
  empty:          { alignItems: 'center', marginTop: 72, paddingHorizontal: 32 },
  emptyIcon:      { fontSize: 54, marginBottom: 16 },
  emptyTitle:     { fontSize: 17, fontWeight: '700', color: '#6E6E8D' },
  emptyHint:      { fontSize: 13, color: '#9B98C0', marginTop: 8, textAlign: 'center', fontWeight: '500' },
});

const dc = StyleSheet.create({
  card:         { marginHorizontal: 16, marginBottom: 14, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 4 },
  topRow:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  eventName:    { fontSize: 17, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.2 },
  customer:     { fontSize: 12, color: '#9B98C0', fontWeight: '500' },
  typeBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(123,97,255,0.1)' },
  typeBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#7B61FF' },
  statusBadge:  { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12 },
  statusTxt:    { fontSize: 11, fontWeight: '800' },
  imgRow:       { marginBottom: 10 },
  thumb:        { width: 72, height: 72, borderRadius: 12, marginRight: 8, backgroundColor: '#1A1A2E' },
  metaRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 },
  meta:         { fontSize: 12, color: '#6E6E8D', fontWeight: '500' },
  upcomingChip: { backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  upcomingTxt:  { fontSize: 11, fontWeight: '700', color: '#3B82F6' },
  finRow:       { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(123,97,255,0.08)', paddingTop: 12, marginBottom: 14 },
  finItem:      { flex: 1, alignItems: 'center' },
  finLabel:     { fontSize: 10, color: '#9B98C0', fontWeight: '500' },
  finVal:       { fontSize: 14, fontWeight: '800', color: '#1A1A2E', marginTop: 3 },
  actionRow:    { flexDirection: 'row', gap: 8 },
  btn:          { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  btnTxt:       { fontSize: 12, fontWeight: '700' },
  createdDate:  { fontSize: 10, color: 'rgba(123,97,255,0.3)', marginTop: 12, textAlign: 'right', fontWeight: '500' },
});

const dmod = StyleSheet.create({
  navbar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: 'rgba(123,97,255,0.12)' },
  navBack:       { paddingVertical: 4, paddingRight: 8, minWidth: 60 },
  navBackTxt:    { fontSize: 14, fontWeight: '700', color: '#7B61FF' },
  navTitle:      { flex: 1, fontSize: 16, fontWeight: '800', color: '#1A1A2E', textAlign: 'center', marginHorizontal: 8, letterSpacing: -0.2 },
  navIconBtn:    { backgroundColor: 'rgba(123,97,255,0.1)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  navIconTxt:    { fontSize: 12, fontWeight: '700', color: '#6E6E8D' },
  navSave:       { backgroundColor: '#7B61FF', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 8 },
  navSaveTxt:    { color: '#fff', fontWeight: '700', fontSize: 14 },
  navEdit:       { backgroundColor: 'rgba(123,97,255,0.1)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  navEditTxt:    { color: '#7B61FF', fontWeight: '700', fontSize: 14 },
  statusBanner:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14, marginBottom: 6, borderRadius: 16, padding: 16, borderWidth: 1 },
  statusTitle:   { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  statusSub:     { fontSize: 11, color: '#9B98C0', marginTop: 3, fontWeight: '500' },
  statusDot:     { width: 12, height: 12, borderRadius: 6 },
  section:       { marginHorizontal: 16, marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  sectionTitle:  { fontSize: 15, fontWeight: '800', color: '#1A1A2E', marginBottom: 12, letterSpacing: -0.2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  hint:          { fontSize: 13, color: '#9B98C0', fontStyle: 'italic', paddingVertical: 4, fontWeight: '500' },
  label:         { fontSize: 11, fontWeight: '700', color: '#6E6E8D', marginTop: 14, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.8 },
  input:         { backgroundColor: '#F7F5FF', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#1A1A2E' },
  imgWrap:       { marginRight: 8, position: 'relative' },
  imgThumb:      { width: 90, height: 90, borderRadius: 14, backgroundColor: '#1A1A2E' },
  imgRemove:     { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  imgAddBtn:     { width: 90, height: 90, borderRadius: 14, borderWidth: 2, borderColor: '#7B61FF', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(123,97,255,0.04)' },
  imgAddPlus:    { fontSize: 28, color: '#7B61FF', fontWeight: '300' },
  imgAddLabel:   { fontSize: 10, color: '#7B61FF', fontWeight: '700', marginTop: 2 },
  infoTable:     { borderWidth: 1, borderColor: 'rgba(123,97,255,0.1)', borderRadius: 12, overflow: 'hidden' },
  infoRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(123,97,255,0.06)' },
  infoKey:       { fontSize: 12, color: '#9B98C0', fontWeight: '600' },
  infoVal:       { fontSize: 13, color: '#1A1A2E', fontWeight: '600', flex: 1, textAlign: 'right' },
  tableHead:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F7F5FF', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, marginBottom: 2 },
  thCell:        { fontSize: 11, fontWeight: '700', color: '#9B98C0' },
  tableRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8, gap: 4 },
  tdCell:        { fontSize: 13, color: '#1A1A2E' },
  cellInput:     { backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, color: '#1A1A2E' },
  totalBar:      { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#7B61FF', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginTop: 10 },
  totalBarLabel: { fontSize: 13, fontWeight: '700', color: '#fff' },
  totalBarVal:   { fontSize: 17, fontWeight: '800', color: '#fff' },
  addRowBtn:     { backgroundColor: 'rgba(123,97,255,0.1)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  addRowTxt:     { fontSize: 12, fontWeight: '700', color: '#7B61FF' },
  copyBtn:       { backgroundColor: 'rgba(39,174,96,0.1)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(39,174,96,0.25)' },
  copyBtnTxt:    { fontSize: 12, fontWeight: '700', color: '#27ae60' },
  payGrid:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
  payGridItem:   { flex: 1, backgroundColor: '#F7F5FF', borderRadius: 12, padding: 12, alignItems: 'center' },
  payGridLabel:  { fontSize: 10, color: '#9B98C0', marginBottom: 4, fontWeight: '500' },
  payGridVal:    { fontSize: 14, fontWeight: '800', color: '#1A1A2E' },
  quotedBox:     { backgroundColor: 'rgba(123,97,255,0.07)', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: 'rgba(123,97,255,0.3)' },
  quotedLabel:   { fontSize: 13, fontWeight: '700', color: '#7B61FF', marginBottom: 8 },
  quotedInput:   { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#7B61FF', paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: '700', color: '#7B61FF' },
  calcBox:       { backgroundColor: '#F7F5FF', borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' },
  calcRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  calcTotalRow:  { borderTopWidth: 1, borderTopColor: 'rgba(123,97,255,0.15)', marginTop: 4, paddingTop: 10 },
  calcLabel:     { fontSize: 13, color: '#6E6E8D', fontWeight: '500' },
  calcVal:       { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  statusPill:    { borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, marginTop: 12 },
  statusPillTxt: { fontSize: 13, fontWeight: '700' },
  reqRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, gap: 8, borderRadius: 8 },
  commentsBox:   { fontSize: 14, color: '#1A1A2E', lineHeight: 22, backgroundColor: '#F7F5FF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(123,97,255,0.12)' },
  bottomRow:     { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 18 },
  cancelBtn:     { flex: 1, paddingVertical: 15, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(123,97,255,0.2)', alignItems: 'center' },
  cancelBtnTxt:  { fontSize: 15, fontWeight: '700', color: '#9B98C0' },
  saveBtn:       { flex: 2, paddingVertical: 15, borderRadius: 16, backgroundColor: '#7B61FF', alignItems: 'center' },
  saveBtnTxt:    { fontSize: 15, fontWeight: '700', color: '#fff' },

  carouselImg:   { width: SW - 32, height: 260, borderRadius: 16, backgroundColor: '#1A1A2E' },
  dotsRow:       { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12, gap: 6 },
  dot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(123,97,255,0.2)' },
  dotActive:     { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7B61FF' },

  // Booking link
  linkBookingBtn:      { borderWidth: 1.5, borderColor: 'rgba(123,97,255,0.5)', borderStyle: 'dashed', borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 10 },
  linkBookingTxt:      { color: '#7B61FF', fontSize: 14, fontWeight: '600' },
  linkedBookingCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(123,97,255,0.05)', borderWidth: 1, borderColor: 'rgba(123,97,255,0.18)', borderRadius: 14, padding: 14, marginBottom: 10 },
  linkedBookingTitle:  { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  linkedBookingSub:    { fontSize: 11, color: '#6E6E8D', marginTop: 2, fontWeight: '500' },
  clearLinkBtn:        { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EF44441A', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  clearLinkTxt:        { color: '#EF4444', fontSize: 13, fontWeight: '700' },
});

const sel = StyleSheet.create({
  trigger:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', paddingHorizontal: 12, paddingVertical: 11 },
  triggerTxt:     { fontSize: 14, color: '#1A1A2E', flex: 1 },
  arrow:          { fontSize: 11, color: '#9B98C0', marginLeft: 4 },
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', alignItems: 'center' },
  centerer:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sheet:          { backgroundColor: '#fff', borderRadius: 18, padding: 16, width: SW * 0.88, maxHeight: SH * 0.6 },
  search:         { backgroundColor: '#F7F5FF', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, marginBottom: 8 },
  option:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8 },
  optionActive:   { backgroundColor: 'rgba(123,97,255,0.07)' },
  optionTxt:      { fontSize: 14, color: '#1A1A2E' },
  optionActiveTxt:{ color: '#7B61FF', fontWeight: '700' },
  noResult:       { textAlign: 'center', color: '#9B98C0', paddingVertical: 20, fontStyle: 'italic' },
});
