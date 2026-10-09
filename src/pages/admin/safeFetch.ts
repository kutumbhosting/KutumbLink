// ─── safeFetch ────────────────────────────────────────────────────────────────
// Returns parsed JSON or null. Never throws. Shared by all admin tab components.
export const safeFetch = async (url: string, options?: RequestInit) => {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      console.warn(`[safeFetch] ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[safeFetch] ${url} → network error`, err);
    return null;
  }
};

// ─── normalizeInterests ───────────────────────────────────────────────────────
export const normalizeInterests = (interests: any): string => {
  if (Array.isArray(interests)) return interests.join(" | ");
  if (typeof interests === "object" && interests !== null)
    return Object.keys(interests).filter((k) => interests[k]).join(" | ");
  return interests || "-";
};

// ─── downloadCSV ─────────────────────────────────────────────────────────────
export const downloadCSV = (data: any[], filename: string) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const csvrows = data.map((row) =>
    Object.values({ ...row, interests: normalizeInterests(row.interests) }).join(",")
  );
  const csv = [headers, ...csvrows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
};
