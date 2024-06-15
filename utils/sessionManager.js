// WILL LIKELY REMOVE THIS CODE SOON
// import sqlite3 from 'sqlite3';
// import { inspect } from 'util';

// const db = new sqlite3.Database('sessions.db');

// db.run(`
//   CREATE TABLE IF NOT EXISTS sessions (
//     userId TEXT PRIMARY KEY,
//     sessionData TEXT
//   )
// `);

// function customReplacer(cache, key, value) {
//   if (typeof value === 'object' && value !== null) {
//     if (cache.has(value)) {
//       return '[Circular]';
//     }
//     cache.add(value);
//   }
//   return value;
// }

// export function createUserSession(userId, sessionData) {
//   const cache = new WeakSet();
//   const serializedSessionData = JSON.stringify(sessionData, (key, value) => customReplacer(cache, key, value));
//   // console.log("serial", serializedSessionData)
//   db.run('INSERT INTO sessions (userId, sessionData) VALUES (?, ?)', [userId, serializedSessionData]);
// }

// export function updateUserSession(userId, sessionData) {
//   const cache = new WeakSet();
//   const serializedSessionData = JSON.stringify(sessionData, (key, value) => customReplacer(cache, key, value));
//   db.run('UPDATE sessions SET sessionData = ? WHERE userId = ?', [serializedSessionData, userId]);
// }

// export function getUserSession(userId) {
//   return new Promise((resolve, reject) => {
//     db.get('SELECT sessionData FROM sessions WHERE userId = ?', [userId], (err, row) => {
//       if (err) {
//         reject(err);
//       } else {
//         if (row) {
//           const serializedData = row.sessionData;
//           const sessionData = JSON.parse(serializedData);
//           resolve(sessionData);
//         } else {
//           resolve(null);
//         }
//       }
//     });
//   });
// }

// export function deleteUserSession(userId) {
//   db.run('DELETE FROM sessions WHERE userId = ?', [userId]);
// }