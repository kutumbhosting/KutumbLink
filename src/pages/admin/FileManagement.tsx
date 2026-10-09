import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { safeFetch } from "./safeFetch";
import { X, Download } from "lucide-react";

interface JsonViewerProps {
  folder: string;
  file: string;
  onClose: () => void;
}

const JsonViewer = ({ folder, file, onClose }: JsonViewerProps) => {
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/files/download?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`)
      .then((res) => res.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [data];
        setRows(arr);
        if (arr.length > 0) {
          setColumns(Object.keys(arr[0]));
        }
      })
      .catch((err) => console.error("Failed to load JSON:", err))
      .finally(() => setLoading(false));
  }, [folder, file]);

  const downloadCSV = () => {
    if (rows.length === 0) return;
    const header = columns.join(",");
    const body = rows.map((row) =>
      columns.map((col) => {
        const val = row[col] ?? "";
        const str = typeof val === "object" ? JSON.stringify(val) : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")
    );
    const csv = [header, ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.replace(".json", ".csv");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 border-b">
          <div>
            <h2 className="text-xl font-bold">{file}</h2>
            <p className="text-sm text-muted-foreground">{rows.length} records</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={downloadCSV} disabled={rows.length === 0} size="sm">
              <Download size={16} className="mr-2" />
              Download CSV
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1 p-4">
          {loading && (
            <p className="text-center text-muted-foreground py-8">Loading...</p>
          )}

          {!loading && rows.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No data found</p>
          )}

          {!loading && rows.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border px-3 py-2 text-left font-semibold">#</th>
                  {columns.map((col) => (
                    <th key={col} className="border px-3 py-2 text-left font-semibold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    <td className="border px-3 py-2 text-muted-foreground">{i + 1}</td>
                    {columns.map((col) => (
                      <td key={col} className="border px-3 py-2 max-w-[200px] truncate">
                        {typeof row[col] === "object"
                          ? JSON.stringify(row[col])
                          : String(row[col] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

const FileManagement = () => {
  const { toast } = useToast();

  const [fileFolder, setFileFolder] = useState<string>("");
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const [debugMsg, setDebugMsg] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // JSON viewer state
  const [viewerFile, setViewerFile] = useState<string | null>(null);

  const showDebug = (msg: string) => {
    setDebugMsg(msg);
    setTimeout(() => setDebugMsg(""), 3000);
  };

  useEffect(() => { fetchFolders(); }, []);

  useEffect(() => {
    if (!fileFolder) { setFiles([]); return; }
    fetchFiles(fileFolder);
  }, [fileFolder]);

  useEffect(() => {
    if (fileFolder) fetchFiles(fileFolder);
  }, [fileFolder, fileRefreshKey]);

  const fetchFiles = async (folder: string) => {
    if (!folder) return;
    const data = await safeFetch(
      `/api/files/list?folder=${encodeURIComponent(folder)}&t=${Date.now()}`
    );
    setFiles(Array.isArray(data) ? [...data] : []);
  };

  const fetchFolders = async () => {
    const data = await safeFetch("/api/folders");
    setFolders(Array.isArray(data) ? data : []);
  };

  const createFolder = async () => {
    if (!newFolder.trim()) { toast({ title: "Folder name required" }); return; }
    const folderName = newFolder.trim();
    const res = await safeFetch("/api/folder/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: folderName }),
    });
    if (!res) {
      toast({ title: "Error", description: "Folder creation failed", variant: "destructive" });
      return;
    }
    setNewFolder("");
    setFileFolder(folderName);
    await fetchFolders();
    await fetchFiles(folderName);
    toast({ title: "Success", description: "Folder created" });
  };

  const deleteFolder = async () => {
    if (!fileFolder) return;
    if (!confirm(`Delete folder "${fileFolder}"?`)) return;
    const res = await safeFetch("/api/folder/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderName: fileFolder }),
    });
    if (!res) {
      toast({ title: "Error", description: "Delete failed", variant: "destructive" });
      return;
    }
    setFileFolder("");
    setFiles([]);
    fetchFolders();
    toast({ title: "Deleted", description: "Folder removed" });
  };

  const deleteFile = async (file: string) => {
    if (!confirm(`Delete ${file}?`)) return;
    if (!fileFolder) { toast({ title: "Select a folder first" }); return; }
    const res = await safeFetch("/api/files/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: fileFolder, fileNames: [file] }),
    });
    if (!res) {
      toast({ title: "Error", description: "Delete failed", variant: "destructive" });
      return;
    }
    await fetchFiles(fileFolder);
    await fetchFolders();
    toast({ title: "Deleted", description: `${file} removed` });
  };

  const uploadSelectedFile = async () => {
    showDebug("🚀 Upload clicked");
    if (!uploadFile || !fileFolder) { showDebug("❌ Missing file or folder"); return; }
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("folder", fileFolder);
    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      if (!res.ok) { showDebug("❌ Upload failed"); return; }
      showDebug("✅ Upload successful");
      setFiles((prev) => [...prev, uploadFile.name]);
      setTimeout(() => fetchFiles(fileFolder), 500);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      showDebug("❌ " + err.message);
    }
  };

  return (
    <>
      {/* JSON Viewer Modal */}
      {viewerFile && (
        <JsonViewer
          folder={fileFolder}
          file={viewerFile}
          onClose={() => setViewerFile(null)}
        />
      )}

      <Card>
        <CardContent className="p-6 space-y-6">
          <h2 className="text-xl font-bold">Folders</h2>
          <p className="text-xs text-muted-foreground -mt-4">
            Note: <code>eventflyer</code> and <code>pastmedia</code> here are one-time seed data only — the live
            site serves flyers and past-event photos/videos from the database (via the Ticketing, Upcoming
            Events, and Past Events tabs), not from these files. Editing them here won't change what visitors see.
          </p>

          {/* Folder selector + delete */}
          <div className="flex w-2/3 gap-3 items-center">
            <select
              className="border p-2 rounded flex-1 text-foreground bg-background"
              value={fileFolder}
              onChange={(e) => setFileFolder(e.target.value)}
            >
              <option value="">-- Select Folder --</option>
              {folders.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <Button variant="destructive" onClick={deleteFolder}>
              Delete Folder
            </Button>
          </div>

          {/* Create new folder */}
          <div className="flex w-2/3 gap-2">
            <Input
              placeholder="New folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
            <Button onClick={createFolder}>Create Folder</Button>
          </div>

          {/* File list */}
          <div className="border rounded p-3">
            <h3 className="text-xl font-bold mb-2">Files List</h3>

            {files.length === 0 && (
              <p className="text-sm text-muted-foreground">No files found</p>
            )}

            {files.map((file) => (
              <div key={file} className="flex flex-wrap justify-between items-center gap-2 border-b py-2">
                <span
                  className={`cursor-pointer hover:underline ${
                    selectedFile === file ? "font-bold text-blue-600" : ""
                  }`}
                  onClick={() => {
                    setSelectedFile(file);
                    if (file.endsWith(".json")) {
                      setViewerFile(file);
                    }
                  }}
                >
                  {file}
                  {file.endsWith(".json") && (
                    <span className="ml-2 text-xs text-primary">(click to view)</span>
                  )}
                </span>

                <div className="flex gap-2">
                  {file.endsWith(".json") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewerFile(file)}
                    >
                      View
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/api/files/download?folder=${fileFolder}&file=${file}`,
                        "_blank"
                      )
                    }
                  >
                    Download
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteFile(file)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Upload new file */}
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setUploadFile(file || null);
              }}
            />
            <div className="flex flex-col gap-2">
              {uploadFile && (
                <p className="text-xs text-green-600">Selected: {uploadFile.name}</p>
              )}
              <Button
                onClick={uploadSelectedFile}
                disabled={!uploadFile}
                className="w-fit"
              >
                Upload File
              </Button>
            </div>
            {debugMsg && (
              <div className="mt-2 text-sm p-2 bg-gray-100 border rounded">
                {debugMsg}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};

export default FileManagement;
