// Khoi phuc active:true cho 37 nhan vien bi CSV-Import sang 01.10.2026 danh
// dau sai thanh inaktiv (ho khong co trong file CSV da import, nhung khong
// he thuc su nghi viec - austritt de trong, 31.12.9999, hoac ngay tuong lai).
// Chay 1 lan duy nhat: node scratch/fix-emp-active-20261001.js
require('dotenv').config();
const { getDb, admin } = require('../src/firestore-client');
const db = getDb();

const ids = ['330337','330478','330485','340259','340276','340301','340312','340322',
  '340361','340370','340429','340444','340473','340877','340910','340918','340955',
  '341377','341384','341409','341411','341424','341450','341457','341503','350152',
  '350153','350445','350527','350529','350544','350598','350604','350605','410018',
  '550078','550198'];

(async () => {
  const batch = db.batch();
  ids.forEach((id) => {
    batch.update(db.collection('emps').doc(id), {
      active: true,
      restoredAt: admin.firestore.FieldValue.serverTimestamp(),
      restoredNote: 'CSV-Import 01.10.2026 faelschlich als inaktiv markiert (fehlte in importierter CSV)',
    });
  });
  await batch.commit();
  console.log('Wiederhergestellt (active:true):', ids.length, 'Mitarbeiter');
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
