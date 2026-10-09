// server/lib/dropBoxScript.js
//
// The shared key and the ready-to-paste Google Apps Script for the Bank
// File Drop Box. The script runs inside kutumbhosting@gmail.com's Google
// account on Google's servers every 5 minutes, so the drop box keeps
// working even when the website's host has put the server to sleep.

import crypto from "crypto";
import { getSetting, setSetting } from "./settings.js";

export async function getOrCreatePushKey() {
  let key = await getSetting("dropbox_push_key");
  if (!key) {
    key = crypto.randomBytes(24).toString("hex");
    await setSetting("dropbox_push_key", key, true);
  }
  return key;
}

export async function buildAppsScript({ siteUrl, folderId, afterImport }) {
  const key = await getOrCreatePushKey();
  return `/**
 * Kutumb — Bank File Drop Box
 *
 * Every 5 minutes: sends each file in the Bank File Drop Box folder to the
 * Kutumb website, which imports it and reconciles bank-transfer payments.
 * Once the website confirms the import, the file is removed from the folder.
 * Files the website can't read are left in place (and the admin mailbox is
 * emailed the reason).
 *
 * Anyone the folder is shared with (as Editor) can drop files — they don't
 * install anything. They get an email saying whether their file was imported.
 *
 * Setup (once), signed in as kutumbhosting@gmail.com:
 *   1. script.google.com → New project → paste this whole file over the code.
 *   2. Save, choose the function "install" in the toolbar, click Run.
 *   3. Approve the permissions (Advanced → Go to project → Allow).
 * That's it — it now runs by itself every 5 minutes.
 *
 * Keep this script private: KEY lets it upload statements to the website.
 */

const SITE_URL = ${JSON.stringify(siteUrl)};
const KEY = ${JSON.stringify(key)};
const FOLDER_ID = ${JSON.stringify(folderId)};
const AFTER_IMPORT = ${JSON.stringify(afterImport)}; // "trash" (recoverable 30 days) or "delete"

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function install() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'checkBankDropBox'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkBankDropBox').timeBased().everyMinutes(5).create();
  checkBankDropBox();
}

function checkBankDropBox() {
  console.log('Sending to ' + SITE_URL);
  var files = DriveApp.getFolderById(FOLDER_ID).getFiles();
  while (files.hasNext()) {
    var file = files.next();
    try {
      sendFile_(file);
    } catch (e) {
      console.error(file.getName() + ': ' + e);
    }
  }
}

function sendFile_(file) {
  var name = file.getName();
  var mime = file.getMimeType();
  var content = fileBytes_(file, mime, name);

  var res = UrlFetchApp.fetch(SITE_URL + '/api/events/reconcile/drive/push', {
    method: 'post',
    contentType: 'application/octet-stream',
    payload: content.bytes,
    headers: {
      'X-Kutumb-Key': KEY,
      'X-File-Id': file.getId(),
      'X-File-Name': encodeURIComponent(name),
      'X-File-Mime': mime,
      'X-File-Modified': file.getLastUpdated().toISOString(),
      'X-File-Converted-Name': encodeURIComponent(content.name),
      'X-File-Owner': ownerEmail_(file)
    },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  console.log(name + ' → HTTP ' + code + ' ' + (body.status || '') + ': ' + (body.message || res.getContentText().slice(0, 200)));

  if (code === 200 && (body.status === 'imported' || body.status === 'already-imported')) {
    removeFile_(file);
  }
  if (code === 401 && body.message === 'Admin login required') {
    console.error('The website at ' + SITE_URL + ' does not have the Bank File Drop Box yet ' +
      '(it is running an older version, or SITE_URL points to the wrong site). ' +
      'Open ' + SITE_URL + '/api/events/reconcile/drive/ping in a browser — it should say ok: true.');
  }
  if (code === 401 && body.status === 'unauthorised') {
    console.error('The website rejected the key. Copy the script again from Admin → Settings → Bank File Drop Box, ' +
      'and make sure the live site uses the same DATABASE_URL and ENCRYPTION_KEY as where you copied it.');
  }
}

// Google Sheets and old .xls files are converted to .xlsx here, by Google.
function fileBytes_(file, mime, name) {
  var token = ScriptApp.getOAuthToken();
  if (mime === MimeType.GOOGLE_SHEETS) {
    return { bytes: exportXlsx_(file.getId(), token), name: name + '.xlsx' };
  }
  if (mime === 'application/vnd.ms-excel' || /\\.xls$/i.test(name)) {
    var copy = JSON.parse(UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.getId() + '/copy?fields=id', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ name: 'kutumb-temp-' + name, mimeType: MimeType.GOOGLE_SHEETS, parents: ['root'] }),
        headers: { Authorization: 'Bearer ' + token }
      }).getContentText());
    try {
      return { bytes: exportXlsx_(copy.id, token), name: name.replace(/\\.xls$/i, '') + '.xlsx' };
    } finally {
      DriveApp.getFileById(copy.id).setTrashed(true);
    }
  }
  return { bytes: file.getBlob().getBytes(), name: name };
}

function exportXlsx_(id, token) {
  return UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=' + encodeURIComponent(XLSX),
    { headers: { Authorization: 'Bearer ' + token } }
  ).getContent();
}

function ownerEmail_(file) {
  try {
    var owner = file.getOwner();
    return owner ? owner.getEmail() : '';
  } catch (e) {
    return '';
  }
}

// Files dropped by other people are owned by them, and Drive only lets the
// owner bin or delete a file. For those, take the file OUT of this folder
// instead (it stays in the uploader's own Drive) — the website already keeps
// a copy, and it will never be imported twice.
function removeFile_(file) {
  var token = ScriptApp.getOAuthToken();
  try {
    if (AFTER_IMPORT === 'delete') {
      var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId(), {
        method: 'delete',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      if (r.getResponseCode() >= 300) throw new Error('delete refused: HTTP ' + r.getResponseCode());
    } else {
      file.setTrashed(true);
    }
  } catch (e) {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.getId() + '?removeParents=' + FOLDER_ID, {
        method: 'patch',
        contentType: 'application/json',
        payload: '{}',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
    if (res.getResponseCode() >= 300) {
      console.warn(file.getName() + ': imported, but could not be removed from the folder (' + res.getContentText().slice(0, 200) + ')');
    } else {
      console.log(file.getName() + ': removed from the folder (owned by ' + ownerEmail_(file) + ')');
    }
  }
}
`;
}
