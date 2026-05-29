import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, Image, Linking, Share, Alert, Modal, Platform, useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../lib/AuthContext';
import { ResizeMode, Video } from 'expo-av';

// ─── Venue data ────────────────────────────────────────────────────────────────
// Replace address, mapsUrl, images and videoUrl with real values.
const VENUES = [
  {
    id: 'hall',
    name: 'A1 Function Hall',
    emoji: '🏛️',
    address: 'Door No. 12-3-456, MG Road, Beside City Bank,\nHyderabad, Telangana – 500 001',
    phone: '+91 98765 43210',
    mapsUrl: 'https://maps.google.com/?q=A1+Function+Hall+Hyderabad',
    images: [
      // 'https://your-cdn.com/a1hall-1.jpg',
      // 'https://your-cdn.com/a1hall-2.jpg',
    ] as string[],
    videoUrl: 'https://1drv.ms/v/c/9b2b22907ae55508/IQBYNvXK3bNZR5WluC4bh8-8AZr0snYi-DMb_bAge2y4kk0?e=VWrnAq&download=1',
    color: '#7B61FF',
  },
  {
    id: 'grand',
    name: 'A1 Grand',
    emoji: '✨',
    address: 'Plot No. 78, Jubilee Hills Rd No. 10,\nHyderabad, Telangana – 500 033',
    phone: '+91 98765 43211',
    mapsUrl: 'https://maps.google.com/?q=A1+Grand+Jubilee+Hills+Hyderabad',
    images: [
      // 'https://your-cdn.com/a1grand-1.jpg',
      // 'https://your-cdn.com/a1grand-2.jpg',
    ] as string[],
    videoUrl: 'https://1drv.ms/v/c/9b2b22907ae55508/IQDN3bMEP6o2S6VcavOjBhXDAZXEy_2aLYPuJDYZFcZb-vY?e=OGCuDt&download=1',
    color: '#e91e63',
  },
];

type Venue = typeof VENUES[0];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function qrUrl(data: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=1A1A2E&bgcolor=ffffff&data=${encodeURIComponent(data)}`;
}

function extFromUrl(url: string): string {
  const p = url.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
  return ['jpg','jpeg','png','webp','gif','mp4','mov','avi','mkv'].includes(p) ? p : 'jpg';
}

function mimeFromExt(ext: string): string {
  if (['mp4','mov','avi','mkv'].includes(ext)) return 'video/mp4';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function downloadAndShare(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert('Not Supported', 'File sharing is not available on web.');
    return;
  }
  const ext      = extFromUrl(url);
  const fileUri  = (FileSystem.cacheDirectory ?? '') + `a1groups_${Date.now()}.${ext}`;
  const result   = await FileSystem.downloadAsync(url, fileUri);
  if (result.status !== 200) throw new Error(`Download failed (HTTP ${result.status})`);
  await Sharing.shareAsync(fileUri, { mimeType: mimeFromExt(ext) });
}

// ─── Share bottom sheet ────────────────────────────────────────────────────────
function ShareSheet({
  venue, visible, onClose, sub, card, text,
}: {
  venue: Venue; visible: boolean; onClose: () => void;
  sub: string; card: string; text: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try { await action(); }
    catch (e: any) { Alert.alert('Error', e?.message ?? 'Failed to share.'); }
    finally { setBusy(null); }
  }

  function shareInfo() {
    run('info', () =>
      Share.share({
        title: venue.name,
        message:
          `${venue.emoji} ${venue.name}\n\n` +
          `📍 Address:\n${venue.address}\n\n` +
          `📞 ${venue.phone}\n\n` +
          `🗺️ Google Maps:\n${venue.mapsUrl}`,
      }).then(() => {})
    );
  }

  function shareImage(url: string, idx: number) {
    run(`img_${idx}`, () => downloadAndShare(url));
  }

  function shareVideo() {
    run('video', () => downloadAndShare(venue.videoUrl));
  }

  const hasImages = venue.images.length > 0;
  const hasVideo  = !!venue.videoUrl;

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[ss.sheet, { backgroundColor: card }]} onStartShouldSetResponder={() => true}>

          {/* Handle */}
          <View style={ss.handle} />

          {/* Title */}
          <View style={[ss.sheetHeader, { borderBottomColor: venue.color + '25' }]}>
            <Text style={[ss.sheetTitle, { color: venue.color }]}>{venue.emoji}  Share {venue.name}</Text>
            <TouchableOpacity onPress={onClose} style={ss.closeBtn}>
              <Text style={{ color: sub, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Venue Info */}
          <TouchableOpacity
            style={[ss.option, { borderColor: venue.color + '30', backgroundColor: venue.color + '08' }]}
            onPress={shareInfo}
            disabled={!!busy}
          >
            <View style={[ss.optIcon, { backgroundColor: venue.color + '18' }]}>
              <Text style={ss.optEmoji}>📋</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ss.optTitle, { color: text }]}>Venue Info</Text>
              <Text style={[ss.optSub, { color: sub }]}>Name, address, phone & Google Maps link</Text>
            </View>
            {busy === 'info' && <ActivityIndicator color={venue.color} size="small" />}
          </TouchableOpacity>

          {/* Images */}
          {hasImages ? (
            venue.images.map((url, idx) => (
              <TouchableOpacity
                key={idx}
                style={[ss.option, { borderColor: venue.color + '30', backgroundColor: venue.color + '08' }]}
                onPress={() => shareImage(url, idx)}
                disabled={!!busy}
              >
                <View style={[ss.optIcon, { backgroundColor: venue.color + '18', overflow: 'hidden' }]}>
                  <Image source={{ uri: url }} style={{ width: 40, height: 40 }} resizeMode="cover" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.optTitle, { color: text }]}>Photo {idx + 1}</Text>
                  <Text style={[ss.optSub, { color: sub }]}>Share actual image file</Text>
                </View>
                {busy === `img_${idx}`
                  ? <ActivityIndicator color={venue.color} size="small" />
                  : <Text style={[ss.optArrow, { color: venue.color }]}>⬆</Text>}
              </TouchableOpacity>
            ))
          ) : (
            <View style={[ss.emptyRow, { borderColor: sub + '25' }]}>
              <Text style={[ss.emptyTxt, { color: sub }]}>🖼️  No images added yet — update images[] in settings.tsx</Text>
            </View>
          )}

          {/* Video */}
          {hasVideo ? (
            <TouchableOpacity
              style={[ss.option, { borderColor: venue.color + '30', backgroundColor: venue.color + '08' }]}
              onPress={shareVideo}
              disabled={!!busy}
            >
              <View style={[ss.optIcon, { backgroundColor: venue.color + '18' }]}>
                <Text style={ss.optEmoji}>🎬</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ss.optTitle, { color: text }]}>Venue Video</Text>
                <Text style={[ss.optSub, { color: sub }]}>Downloads & shares actual video file</Text>
              </View>
              {busy === 'video'
                ? <ActivityIndicator color={venue.color} size="small" />
                : <Text style={[ss.optArrow, { color: venue.color }]}>⬆</Text>}
            </TouchableOpacity>
          ) : (
            <View style={[ss.emptyRow, { borderColor: sub + '25' }]}>
              <Text style={[ss.emptyTxt, { color: sub }]}>🎬  No video added yet — update videoUrl in settings.tsx</Text>
            </View>
          )}

          {busy && (
            <Text style={[ss.busyNote, { color: sub }]}>Downloading file, please wait…</Text>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Venue card ────────────────────────────────────────────────────────────────
function VenueCard({
  venue, card, text, sub, isDark,
}: {
  venue: Venue; card: string; text: string; sub: string; isDark: boolean;
}) {
  const [copied,        setCopied]        = useState(false);
  const [qrVisible,     setQrVisible]     = useState(false);
  const [shareVisible,  setShareVisible]  = useState(false);
  const [videoError,    setVideoError]    = useState(false);

  async function copyAddress() {
    await Clipboard.setStringAsync(`${venue.name}\n${venue.address}\n${venue.phone}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openMaps() {
    Linking.openURL(venue.mapsUrl).catch(() => Alert.alert('Error', 'Could not open Maps.'));
  }

  return (
    <View style={[vc.card, { borderColor: venue.color + '35' }]}>

      {/* Header */}
      <View style={[vc.header, { backgroundColor: venue.color + '12' }]}>
        <Text style={vc.emoji}>{venue.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[vc.name, { color: venue.color }]}>{venue.name}</Text>
          <Text style={[vc.phone, { color: sub }]}>{venue.phone}</Text>
        </View>
      </View>

      {/* Address */}
      <View style={vc.addrBlock}>
        <Text style={[vc.addrLabel, { color: sub }]}>📍 ADDRESS</Text>
        <Text style={[vc.addrText, { color: text }]}>{venue.address}</Text>
      </View>

      {/* Action buttons */}
      <View style={vc.actions}>
        <TouchableOpacity
          style={[vc.btn, copied && { backgroundColor: '#27ae6018', borderColor: '#27ae6040' }, !copied && { backgroundColor: '#F7F5FF', borderColor: venue.color + '30' }]}
          onPress={copyAddress}
        >
          <Text style={[vc.btnTxt, { color: copied ? '#27ae60' : venue.color }]}>
            {copied ? '✓ Copied' : '📋 Copy'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[vc.btn, { backgroundColor: '#F7F5FF', borderColor: venue.color + '30' }]} onPress={openMaps}>
          <Text style={[vc.btnTxt, { color: venue.color }]}>🗺️ Maps</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[vc.btn, { backgroundColor: venue.color + '12', borderColor: venue.color + '40' }]} onPress={() => setShareVisible(true)}>
          <Text style={[vc.btnTxt, { color: venue.color }]}>📤 Share</Text>
        </TouchableOpacity>
      </View>

      {/* QR Code */}
      <TouchableOpacity style={[vc.qrToggle, { borderColor: venue.color + '30' }]} onPress={() => setQrVisible(v => !v)}>
        <Text style={[vc.qrToggleTxt, { color: venue.color }]}>{qrVisible ? '▲  Hide QR Code' : '▼  Show QR Code'}</Text>
      </TouchableOpacity>

      {qrVisible && (
        <View style={vc.qrWrap}>
          <Image source={{ uri: qrUrl(venue.mapsUrl) }} style={vc.qrImg} resizeMode="contain" />
          <Text style={[vc.qrHint, { color: sub }]}>Scan to open in Google Maps</Text>
        </View>
      )}

      {/* Images carousel */}
      {venue.images.length > 0 ? (
        <View style={vc.imgSection}>
          <Text style={[vc.imgLabel, { color: sub }]}>🖼️ VENUE PHOTOS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }}>
            {venue.images.map((uri, i) => (
              <View key={i} style={vc.imgWrap}>
                <Image source={{ uri }} style={vc.imgThumb} resizeMode="cover" />
                {/* Individual image share button */}
                <TouchableOpacity
                  style={[vc.imgShareBtn, { backgroundColor: venue.color }]}
                  onPress={async () => {
                    try { await downloadAndShare(uri); }
                    catch (e: any) { Alert.alert('Error', e?.message ?? 'Failed to share.'); }
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11 }}>📤</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={[vc.noMediaRow, { borderColor: sub + '20' }]}>
          <Text style={[vc.noMediaTxt, { color: sub }]}>🖼️  Add image URLs to images[] in settings.tsx</Text>
        </View>
      )}

      {/* Video */}
      <View style={vc.videoWrap}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={[vc.videoLabel, { color: sub, flex: 1 }]}>🎬 VENUE VIDEO</Text>
          {venue.videoUrl && !videoError && (
            <TouchableOpacity
              style={[vc.videoShareBtn, { backgroundColor: venue.color + '15', borderColor: venue.color + '40' }]}
              onPress={async () => {
                try { await downloadAndShare(venue.videoUrl); }
                catch (e: any) { Alert.alert('Error', e?.message ?? 'Failed to share.'); }
              }}
            >
              <Text style={[vc.videoShareTxt, { color: venue.color }]}>📤 Share Video</Text>
            </TouchableOpacity>
          )}
        </View>
        {venue.videoUrl && !videoError ? (
          <Video
            source={{ uri: venue.videoUrl }}
            style={vc.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            onError={() => setVideoError(true)}
          />
        ) : (
          <View style={[vc.videoPlaceholder, { borderColor: venue.color + '30', backgroundColor: isDark ? '#1a1a2e' : '#F7F5FF' }]}>
            <Text style={{ fontSize: 30 }}>🎥</Text>
            <Text style={[vc.videoPlaceholderTxt, { color: sub }]}>
              {venue.videoUrl && videoError ? 'Could not load video' : 'No video URL set yet'}
            </Text>
            <Text style={[vc.videoPlaceholderHint, { color: venue.color }]}>Update videoUrl in settings.tsx</Text>
          </View>
        )}
      </View>

      {/* Share sheet */}
      <ShareSheet
        venue={venue}
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        card={card}
        text={text}
        sub={sub}
      />
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const isDark = useColorScheme() === 'dark';
  const bg   = isDark ? '#12102B' : '#EEF0FF';
  const card = isDark ? '#1E1B3A' : '#FFFFFF';
  const text = isDark ? '#F0EDFF' : '#1A1A2E';
  const sub  = isDark ? '#9B98C0' : '#6E6E8D';

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  return (
    <SafeAreaView style={[sc.container, { backgroundColor: bg }]}>
      <View style={[sc.header, { backgroundColor: card }]}>
        <Text style={[sc.headerTitle, { color: text }]}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[sc.body, { backgroundColor: bg }]}>

        {/* App info */}
        <View style={[sc.card, { backgroundColor: card }]}>
          <View style={sc.appRow}>
            <View style={sc.logoBox}><Text style={sc.logoText}>A1</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={[sc.appName, { color: text }]}>A1 Groups</Text>
              <Text style={[sc.appSub, { color: sub }]}>Business Management App</Text>
            </View>
          </View>
        </View>

        {/* Session */}
        <View style={[sc.card, { backgroundColor: card }]}>
          <Text style={[sc.sectionLabel, { color: sub }]}>SESSION</Text>
          <View style={sc.infoRow}>
            <Text style={[sc.infoLabel, { color: text }]}>PIN expires after</Text>
            <Text style={[sc.infoValue, { color: '#7B61FF' }]}>24 hours</Text>
          </View>
        </View>

        {/* Addresses */}
        <View style={[sc.card, { backgroundColor: card }]}>
          <Text style={[sc.sectionLabel, { color: sub }]}>ADDRESSES</Text>
          {VENUES.map(venue => (
            <VenueCard key={venue.id} venue={venue} card={card} text={text} sub={sub} isDark={isDark} />
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={[sc.logoutBtn, loggingOut && sc.logoutBtnDisabled]}
          onPress={handleLogout}
          disabled={loggingOut}
          activeOpacity={0.85}
        >
          {loggingOut ? <ActivityIndicator color="#FF4D4D" size="small" /> : <Text style={sc.logoutIcon}>🚪</Text>}
          <Text style={sc.logoutText}>{loggingOut ? 'Logging out…' : 'Logout'}</Text>
        </TouchableOpacity>

        <Text style={[sc.hint, { color: sub }]}>You&apos;ll need to enter your PIN again after logout.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Share sheet styles ────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:       { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', alignSelf: 'center', marginBottom: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, marginBottom: 12 },
  sheetTitle:  { flex: 1, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  closeBtn:    { padding: 4 },
  option:      { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, borderWidth: 1, padding: 13, marginBottom: 9 },
  optIcon:     { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optEmoji:    { fontSize: 20 },
  optTitle:    { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  optSub:      { fontSize: 11 },
  optArrow:    { fontSize: 16, fontWeight: '800' },
  emptyRow:    { borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', padding: 12, marginBottom: 9, alignItems: 'center' },
  emptyTxt:    { fontSize: 12 },
  busyNote:    { textAlign: 'center', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});

// ─── Venue card styles ─────────────────────────────────────────────────────────
const vc = StyleSheet.create({
  card:         { borderRadius: 14, borderWidth: 1.5, marginBottom: 14, overflow: 'hidden' },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  emoji:        { fontSize: 22 },
  name:         { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  phone:        { fontSize: 12, marginTop: 1 },
  addrBlock:    { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  addrLabel:    { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  addrText:     { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  actions:      { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  btn:          { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 9, alignItems: 'center' },
  btnTxt:       { fontSize: 12, fontWeight: '700' },
  qrToggle:     { marginHorizontal: 14, marginBottom: 10, borderRadius: 10, borderWidth: 1, paddingVertical: 9, alignItems: 'center' },
  qrToggleTxt:  { fontSize: 12, fontWeight: '700' },
  qrWrap:       { alignItems: 'center', paddingBottom: 14 },
  qrImg:        { width: 180, height: 180, borderRadius: 10 },
  qrHint:       { fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  imgSection:   { paddingHorizontal: 14, paddingBottom: 10 },
  imgLabel:     { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  imgWrap:      { marginRight: 10, position: 'relative' },
  imgThumb:     { width: 110, height: 80, borderRadius: 10 },
  imgShareBtn:  { position: 'absolute', top: 5, right: 5, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 },
  noMediaRow:   { marginHorizontal: 14, marginBottom: 10, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', padding: 10, alignItems: 'center' },
  noMediaTxt:   { fontSize: 11 },
  videoWrap:    { paddingHorizontal: 14, paddingBottom: 14 },
  videoLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  videoShareBtn:{ borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  videoShareTxt:{ fontSize: 11, fontWeight: '700' },
  video:        { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#000' },
  videoPlaceholder:    { height: 100, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoPlaceholderTxt: { fontSize: 12, fontWeight: '500' },
  videoPlaceholderHint:{ fontSize: 10 },
});

// ─── Screen styles ─────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  container:         { flex: 1 },
  header:            { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(123,97,255,0.12)' },
  headerTitle:       { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  body:              { padding: 16, gap: 12, paddingBottom: 40 },
  card:              { borderRadius: 16, padding: 16, shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  appRow:            { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoBox:           { width: 52, height: 52, borderRadius: 14, backgroundColor: '#7B61FF', alignItems: 'center', justifyContent: 'center' },
  logoText:          { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  appName:           { fontSize: 17, fontWeight: '700' },
  appSub:            { fontSize: 13, marginTop: 2 },
  sectionLabel:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  infoRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel:         { fontSize: 14, fontWeight: '500' },
  infoValue:         { fontSize: 14, fontWeight: '700' },
  logoutBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(255,77,77,0.1)', borderWidth: 1, borderColor: 'rgba(255,77,77,0.3)', borderRadius: 16, paddingVertical: 16, marginTop: 8 },
  logoutBtnDisabled: { opacity: 0.6 },
  logoutIcon:        { fontSize: 20 },
  logoutText:        { fontSize: 16, fontWeight: '700', color: '#FF4D4D' },
  hint:              { fontSize: 12, textAlign: 'center', marginTop: 4 },
});
