import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { DATA_ROOT } from "../lib/dataRoot.js";
import { requireAdmin } from "../lib/auth.js";

const router = express.Router();
router.use(requireAdmin);

// ======================================================
// 📁 MULTER SETUP (FILE UPLOAD CONFIG)
// ======================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.body.folder || "default";
    const dir = path.join(DATA_ROOT, folder);

    fs.mkdirSync(dir, { recursive: true });

    cb(null, dir);
  },

  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// ======================================================
// 📂 LIST ALL FOLDERS
// ======================================================
router.get("/folders", (req, res) => {
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    const folders = fs
      .readdirSync(DATA_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    res.json(folders);
  } catch (err) {
    res.status(500).json({ message: "Failed to list folders" });
  }
});


// ======================================================
// 📁 CREATE NEW FOLDER
// ======================================================
router.post("/folder/create", (req, res) => {
  try {
    const { folderName, folder } = req.body;
    const name = folderName || folder;

    if (!name) {
      return res.status(400).json({ message: "Folder name required" });
    }

    const dir = path.join(DATA_ROOT, name);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    res.json({ message: "Folder created", folder: name });
  } catch (err) {
    res.status(500).json({ message: "Folder creation failed" });
  }
});

// ======================================================
// 🗑️ DELETE ENTIRE FOLDER (SAFE)
// ======================================================
router.post("/folder/delete", (req, res) => {
  try {
    const { folderName } = req.body;

    // ❌ Validate input
    if (!folderName || typeof folderName !== "string") {
      return res.status(400).json({ message: "Invalid folder name" });
    }

    // ❌ Prevent path traversal
    if (folderName.includes("..") || folderName.includes("/")) {
      return res.status(400).json({ message: "Invalid folder path" });
    }

    const dir = path.join(DATA_ROOT, folderName);

    // ❌ Ensure inside DATA_ROOT
    const resolvedPath = path.resolve(dir);
    if (!resolvedPath.startsWith(path.resolve(DATA_ROOT))) {
      return res.status(403).json({ message: "Access denied" });
    }

    // ❌ Protect system folders (VERY IMPORTANT)
    const protectedFolders = ["events", "members", "upcomingevents", "eventflyer", "manuals"];

    if (protectedFolders.includes(folderName)) {
      return res.status(403).json({
        message: "Cannot delete protected folder",
      });
    }

    // ❌ Check existence
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ message: "Folder not found" });
    }

    // ✅ Delete
    fs.rmSync(dir, { recursive: true, force: true });

    res.json({
      message: "Folder deleted successfully",
      folder: folderName,
    });

  } catch (err) {
    console.error("FOLDER DELETE ERROR:", err);
    res.status(500).json({ message: "Folder delete failed" });
  }
});


// ======================================================
// 📄 LIST FILES IN SELECTED FOLDER
// ======================================================
router.get("/files/list", (req, res) => {
  try {
    const { folder } = req.query;

    const dir = path.join(DATA_ROOT, folder);

    if (!fs.existsSync(dir)) {
      return res.json([]);
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => fs.statSync(path.join(dir, f)).isFile());

    res.json(files);
  } catch (err) {
    res.status(500).json({ message: "Failed to list files" });
  }
});


// ======================================================
// 📤 UPLOAD FILE INTO SELECTED FOLDER
// ======================================================
router.post("/files/upload", upload.single("file"), (req, res) => {
  try {
    const folder = req.body.folder;

    console.log("UPLOAD FOLDER:", folder); // 🔥 DEBUG

    if (!folder) {
      return res.status(400).json({ message: "Folder is required" });
    }

    const targetDir = path.join(DATA_ROOT, folder);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const oldPath = req.file.path;
    const newPath = path.join(targetDir, req.file.originalname);

    setTimeout(() => {
  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    console.error("Rename failed:", err);
  }
}, 200);


    res.json({
      message: "File uploaded",
      fileName: req.file.originalname,
      folder,
    });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// ======================================================
// 🗑️ DELETE FILE(S) FROM FOLDER
// ======================================================
router.post("/files/delete", (req, res) => {
  try {
    const { folder, fileNames, fileName } = req.body;

    // Normalize to array safely
    const files = Array.isArray(fileNames)
      ? fileNames
      : fileNames
      ? [fileNames]
      : fileName
      ? [fileName]
      : [];

    const dir = path.join(DATA_ROOT, folder);

    if (!fs.existsSync(dir)) {
      return res.status(404).json({ message: "Folder not found" });
    }

    files.forEach((file) => {
      const filePath = path.join(dir, file);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    res.json({ message: "File(s) deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
});


// ======================================================
// ⬇️ DOWNLOAD FILE
// ======================================================
router.get("/files/download", (req, res) => {
  try {
    const { folder, file } = req.query;

    const filePath = path.join(DATA_ROOT, folder, file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" });
    }

    res.download(filePath);
  } catch (err) {
    res.status(500).json({ message: "Download failed" });
  }
});


// ======================================================
// 🔌 EXPORT ROUTER
// ======================================================
export default router;
