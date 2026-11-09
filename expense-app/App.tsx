import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Entry } from './src/types';
import { addEntry, deleteEntry, loadEntries, toCsv } from './src/storage';
import HomeScreen from './src/screens/HomeScreen';
import AddEntryScreen from './src/screens/AddEntryScreen';

type Screen = 'home' | 'add';

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [screen, setScreen] = useState<Screen>('home');

  useEffect(() => {
    loadEntries().then(setEntries);
  }, []);

  const handleSave = async (entry: Entry) => {
    const next = await addEntry(entry);
    setEntries(next);
    setScreen('home');
  };

  const handleDelete = async (id: string) => {
    const next = await deleteEntry(id);
    setEntries(next);
  };

  const handleExport = async () => {
    const csv = toCsv(entries);
    const fileUri = `${FileSystem.documentDirectory}sakutto-keihi.csv`;
    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'CSVを書き出す' });
    }
  };

  return (
    <>
      {screen === 'home' && (
        <HomeScreen
          entries={entries}
          monthKeyValue={currentMonthKey()}
          onAdd={() => setScreen('add')}
          onExport={handleExport}
          onDelete={handleDelete}
        />
      )}
      {screen === 'add' && <AddEntryScreen onSave={handleSave} onCancel={() => setScreen('home')} />}
      <StatusBar style="light" />
    </>
  );
}
