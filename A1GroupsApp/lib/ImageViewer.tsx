import {
  Alert,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useEffect, useRef, useState } from 'react';
import * as Sharing from 'expo-sharing';

let FileSystem: any = null;
let MediaLibrary: any = null;
let Clipboard: any = null;
try { FileSystem  = require('expo-file-system'); }  catch {}
try { MediaLibrary = require('expo-media-library'); } catch {}
try { Clipboard   = require('expo-clipboard'); }    catch {}

const { width: SW, height: SH } = Dimensions.get('window');

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

async function localCopy(uri: string): Promise<string> {
  if (!FileSystem) throw new Error('FileSystem not available');
  const name = (uri.split('/').pop() ?? 'img.jpg').split('?')[0];
  const dest = FileSystem.cacheDirectory + name;
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) return dest;
  const { uri: dl } = await FileSystem.downloadAsync(uri, dest);
  return dl;
}

export default function ImageViewer({ images, initialIndex = 0, onClose }: Props) {
  const [current, setCurrent] = useState(initialIndex);
  const [busy,    setBusy]    = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (initialIndex > 0) {
      setTimeout(() => scrollRef.current?.scrollTo({ x: initialIndex * SW, animated: false }), 50);
    }
  }, [initialIndex]);

  const uri = images[current] ?? '';

  async function handleSave() {
    if (!FileSystem || !MediaLibrary) {
      Alert.alert('Not available', 'Saving to gallery is not supported on this platform.');
      return;
    }
    setBusy(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow gallery access to save images.');
        return;
      }
      const local = await localCopy(uri);
      await MediaLibrary.saveToLibraryAsync(local);
      Alert.alert('Saved', 'Image saved to your gallery.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save image.');
    } finally { setBusy(false); }
  }

  async function handleShare() {
    setBusy(true);
    try {
      if (FileSystem) {
        const local = await localCopy(uri);
        await Sharing.shareAsync(local, { mimeType: 'image/jpeg', dialogTitle: 'Share Image' });
      } else {
        await Sharing.shareAsync(uri);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not share image.');
    } finally { setBusy(false); }
  }

  async function handleCopy() {
    try {
      if (Clipboard) {
        await Clipboard.setStringAsync(uri);
        Alert.alert('Copied', 'Image link copied to clipboard.');
      } else {
        Alert.alert('Not available', 'Clipboard is not supported on this platform.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not copy link.');
    }
  }

  return (
    <Modal transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.bg}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.counter}>{images.length > 1 ? `${current + 1} / ${images.length}` : ' '}</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.closeTxt}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Image pager */}
        <ScrollView
          ref={scrollRef}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          onMomentumScrollEnd={e => setCurrent(Math.round(e.nativeEvent.contentOffset.x / SW))}
        >
          {images.map((imgUri, i) => (
            <View key={i} style={s.imgPage}>
              <Image source={{ uri: imgUri }} style={s.img} resizeMode="contain" />
            </View>
          ))}
        </ScrollView>

        {/* Dots */}
        {images.length > 1 && (
          <View style={s.dots}>
            {images.map((_, i) => (
              <View key={i} style={[s.dot, i === current && s.dotActive]} />
            ))}
          </View>
        )}

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity onPress={handleSave} disabled={busy} style={s.actionBtn}>
            <Text style={s.actionIcon}>💾</Text>
            <Text style={s.actionLabel}>Save</Text>
          </TouchableOpacity>
          <View style={s.actionDivider} />
          <TouchableOpacity onPress={handleShare} disabled={busy} style={s.actionBtn}>
            <Text style={s.actionIcon}>📤</Text>
            <Text style={s.actionLabel}>Share</Text>
          </TouchableOpacity>
          <View style={s.actionDivider} />
          <TouchableOpacity onPress={handleCopy} disabled={busy} style={s.actionBtn}>
            <Text style={s.actionIcon}>🔗</Text>
            <Text style={s.actionLabel}>Copy Link</Text>
          </TouchableOpacity>
        </View>

      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  bg:            { flex: 1, backgroundColor: '#000' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 54, paddingBottom: 14 },
  counter:       { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' },
  closeBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  closeTxt:      { color: '#fff', fontSize: 17, fontWeight: '700' },
  imgPage:       { width: SW, flex: 1, alignItems: 'center', justifyContent: 'center' },
  img:           { width: SW, height: SH * 0.72 },
  dots:          { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 12 },
  dot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive:     { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  actions:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, paddingBottom: 38, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)' },
  actionBtn:     { flex: 1, alignItems: 'center', paddingVertical: 8 },
  actionIcon:    { fontSize: 30, marginBottom: 6 },
  actionLabel:   { color: '#fff', fontSize: 13, fontWeight: '600' },
  actionDivider: { width: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.12)' },
});
