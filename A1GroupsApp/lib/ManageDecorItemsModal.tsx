import React, { useState } from 'react';
import {
  Alert, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { DecorMasterItem } from './api';

interface Props {
  visible: boolean;
  onClose: () => void;
  rawItems: DecorMasterItem[];
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export default function ManageDecorItemsModal({ visible, onClose, rawItems, onAdd, onRemove }: Props) {
  const [search,   setSearch]   = useState('');
  const [newName,  setNewName]  = useState('');
  const [showAdd,  setShowAdd]  = useState(false);
  const [saving,   setSaving]   = useState(false);

  const filtered = rawItems.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  async function handleAdd() {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onAdd(name);
      setNewName('');
      setShowAdd(false);
    } catch (e: any) {
      const isDup = e?.message?.includes('409') || e?.message?.toLowerCase().includes('duplicate');
      Alert.alert('Error', isDup ? `"${name}" already exists.` : (e?.message ?? 'Failed to add item.'));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;
    setSearch(''); setNewName(''); setShowAdd(false);
    onClose();
  }

  function confirmDelete(item: DecorMasterItem) {
    const del = async () => {
      try {
        await onRemove(item._id);
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Failed to delete item.');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${item.name}"?`)) del();
    } else {
      Alert.alert('Delete Item', `Remove "${item.name}" from the list?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: del },
      ]);
    }
  }

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={handleClose}>
      <View style={s.backdrop}>
        <View style={s.sheet} onStartShouldSetResponder={() => true}>

          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>Manage Decor Items</Text>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
              <Text style={s.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <TextInput
            style={s.search}
            placeholder="Search items..."
            placeholderTextColor="#9B98C0"
            value={search}
            onChangeText={setSearch}
          />

          {/* Add New — always visible as first row */}
          {showAdd ? (
            <View style={s.addRow}>
              <TextInput
                style={s.addInput}
                placeholder="Enter item name..."
                placeholderTextColor="#9B98C0"
                value={newName}
                onChangeText={setNewName}
                autoFocus
                onSubmitEditing={handleAdd}
                returnKeyType="done"
              />
              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleAdd} disabled={saving}>
                <Text style={s.saveBtnTxt}>{saving ? 'Saving…' : 'Add'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.discardBtn} onPress={() => { setShowAdd(false); setNewName(''); }} disabled={saving}>
                <Text style={s.discardTxt}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={s.addNewRow} onPress={() => setShowAdd(true)}>
              <View style={s.addNewIcon}>
                <Text style={s.addNewPlus}>+</Text>
              </View>
              <Text style={s.addNewTxt}>Add New Item</Text>
            </TouchableOpacity>
          )}

          <View style={s.divider} />

          {/* Items list */}
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filtered.length === 0 ? (
              <Text style={s.empty}>
                {search ? 'No items match your search.' : 'No items yet.'}
              </Text>
            ) : (
              filtered.map(item => (
                <View key={item._id} style={s.itemRow}>
                  <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
                  <TouchableOpacity style={s.delBtn} onPress={() => confirmDelete(item)}>
                    <Text style={s.delTxt}>🗑</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <View style={{ height: 24 }} />
          </ScrollView>

          <Text style={s.count}>{rawItems.length} item{rawItems.length !== 1 ? 's' : ''} in list</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  header:      { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title:       { flex: 1, fontSize: 18, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.3 },
  closeBtn:    { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0EEFF', alignItems: 'center', justifyContent: 'center' },
  closeTxt:    { fontSize: 13, color: '#7B61FF', fontWeight: '700' },
  search:      { backgroundColor: '#F7F5FF', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(123,97,255,0.15)', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#1A1A2E', marginBottom: 10 },
  addNewRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4 },
  addNewIcon:  { width: 34, height: 34, borderRadius: 17, backgroundColor: '#7B61FF', alignItems: 'center', justifyContent: 'center' },
  addNewPlus:  { color: '#fff', fontSize: 22, fontWeight: '300', lineHeight: 26 },
  addNewTxt:   { fontSize: 15, fontWeight: '700', color: '#7B61FF' },
  addRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  addInput:    { flex: 1, backgroundColor: '#F7F5FF', borderRadius: 12, borderWidth: 1.5, borderColor: '#7B61FF', paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#1A1A2E' },
  saveBtn:     { backgroundColor: '#7B61FF', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnTxt:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  discardBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0EEFF', alignItems: 'center', justifyContent: 'center' },
  discardTxt:  { color: '#7B61FF', fontSize: 14, fontWeight: '700' },
  divider:     { height: 1, backgroundColor: 'rgba(123,97,255,0.1)', marginVertical: 6 },
  itemRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(123,97,255,0.07)' },
  itemName:    { flex: 1, fontSize: 14, color: '#1A1A2E', fontWeight: '500' },
  delBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF0F0', alignItems: 'center', justifyContent: 'center' },
  delTxt:      { fontSize: 15 },
  empty:       { textAlign: 'center', color: '#9B98C0', paddingVertical: 32, fontSize: 13, fontStyle: 'italic' },
  count:       { textAlign: 'center', color: '#C5C0E0', fontSize: 11, fontWeight: '500', paddingVertical: 10 },
});
