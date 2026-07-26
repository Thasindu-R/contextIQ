// Tests for the upload flow, with the API client mocked so nothing
// reaches the backend.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DocumentsPage from "@/pages/DocumentsPage";
import { ToastProvider } from "@/hooks/useToast";
import type { DocumentOut } from "@/types";

// vi.mock is hoisted above the file's consts, so the spies have to be
// created inside vi.hoisted to exist by the time the factory runs.
const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock("@/api/client", () => api);

function doc(overrides: Partial<DocumentOut> = {}): DocumentOut {
  return {
    id: "doc-1",
    filename: "policy.pdf",
    upload_time: "2026-07-20T10:00:00Z",
    status: "ready",
    page_count: 12,
    ...overrides,
  };
}

function pdf(name = "policy.pdf", sizeBytes = 1024): File {
  const file = new File(["%PDF-1.4 fake"], name, { type: "application/pdf" });
  // Defining the size beats allocating 20MB of ArrayBuffer in a test.
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

function renderPage() {
  return render(
    <ToastProvider>
      <DocumentsPage />
    </ToastProvider>,
  );
}

async function fileInput(): Promise<HTMLInputElement> {
  return (await screen.findByLabelText("Choose documents to upload")) as HTMLInputElement;
}

beforeEach(() => {
  api.listDocuments.mockResolvedValue([]);
  api.uploadDocument.mockResolvedValue([doc()]);
  api.deleteDocument.mockResolvedValue(undefined);
});

describe("document library", () => {
  it("lists what the API returns, with its ingestion status", async () => {
    api.listDocuments.mockResolvedValue([
      doc({ id: "a", filename: "policy.pdf", status: "ready" }),
      doc({ id: "b", filename: "broken.pdf", status: "failed", page_count: null }),
    ]);

    renderPage();

    expect(await screen.findByText("policy.pdf")).toBeInTheDocument();
    expect(screen.getByText("broken.pdf")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows an empty state before anything is uploaded", async () => {
    renderPage();

    expect(await screen.findByText("No documents yet")).toBeInTheDocument();
  });
});

describe("upload flow", () => {
  it("uploads the chosen file and shows it once ingestion finishes", async () => {
    // Empty to begin with, then the ingested document on the re-fetch.
    api.listDocuments.mockResolvedValueOnce([]).mockResolvedValue([doc()]);
    renderPage();
    await screen.findByText("No documents yet");

    await userEvent.upload(await fileInput(), pdf());

    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).toHaveBeenCalledWith([
      expect.objectContaining({ name: "policy.pdf" }),
    ]);

    // The list is re-fetched rather than patched locally, because a
    // partly-failed batch leaves local state unreliable.
    expect(await screen.findByText("policy.pdf")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(api.listDocuments).toHaveBeenCalledTimes(2);
  });

  it("rejects a file over the size limit without calling the API", async () => {
    renderPage();
    await screen.findByText("No documents yet");

    await userEvent.upload(await fileInput(), pdf("huge.pdf", 21 * 1024 * 1024));

    expect(await screen.findByText("File too large")).toBeInTheDocument();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it("restricts the file picker to the types the extractor handles", async () => {
    renderPage();

    // The picker filters by `accept` before the app sees anything, which
    // is why the unsupported-type case below has to arrive by drop.
    expect(await fileInput()).toHaveAttribute("accept", ".pdf,.txt,application/pdf,text/plain");
  });

  it("rejects an unsupported type dropped past the picker, without calling the API", async () => {
    renderPage();
    const dropZone = await screen.findByText("Drop PDFs or text files here");

    const docx = new File(["x"], "notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.drop(dropZone.parentElement as HTMLElement, { dataTransfer: { files: [docx] } });

    expect(await screen.findByText("Unsupported file type")).toBeInTheDocument();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it("accepts a dropped PDF", async () => {
    renderPage();
    const dropZone = await screen.findByText("Drop PDFs or text files here");

    fireEvent.drop(dropZone.parentElement as HTMLElement, {
      dataTransfer: { files: [pdf("dropped.pdf")] },
    });

    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).toHaveBeenCalledWith([
      expect.objectContaining({ name: "dropped.pdf" }),
    ]);
  });

  it("accepts a .txt whose type the browser reports as empty", async () => {
    renderPage();
    const dropZone = await screen.findByText("Drop PDFs or text files here");

    // Some browsers report no MIME type for plain text; falling back to
    // the extension avoids rejecting a file the backend would accept.
    const txt = new File(["hello"], "notes.txt", { type: "" });
    fireEvent.drop(dropZone.parentElement as HTMLElement, { dataTransfer: { files: [txt] } });

    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Unsupported file type")).not.toBeInTheDocument();
  });

  it("uploads the acceptable files from a mixed selection", async () => {
    renderPage();
    await screen.findByText("No documents yet");

    await userEvent.upload(await fileInput(), [pdf("good.pdf"), pdf("huge.pdf", 21 * 1024 * 1024)]);

    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).toHaveBeenCalledWith([
      expect.objectContaining({ name: "good.pdf" }),
    ]);
    expect(await screen.findByText("File too large")).toBeInTheDocument();
  });

  it("surfaces the backend's detail when ingestion fails, and still re-fetches", async () => {
    api.uploadDocument.mockRejectedValue(new Error("Could not extract text from the document."));
    renderPage();
    await screen.findByText("No documents yet");

    await userEvent.upload(await fileInput(), pdf("scanned.pdf"));

    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    expect(screen.getByText("Could not extract text from the document.")).toBeInTheDocument();
    // A mid-batch failure can still have committed earlier files.
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2));
  });

  it("shows an indeterminate progress state while ingesting", async () => {
    let finishUpload = (): void => {};
    api.uploadDocument.mockImplementation(
      () => new Promise((resolve) => (finishUpload = () => resolve([doc()]))),
    );
    renderPage();
    await screen.findByText("No documents yet");

    await userEvent.upload(await fileInput(), pdf());

    // Ingestion is synchronous with no progress endpoint, so the UI can
    // only say "working", not "40%".
    expect(await screen.findByText("Ingesting...")).toBeInTheDocument();

    finishUpload();
    await waitFor(() => expect(screen.queryByText("Ingesting...")).not.toBeInTheDocument());
  });
});

describe("delete", () => {
  it("deletes a document and re-fetches the list", async () => {
    api.listDocuments.mockResolvedValueOnce([doc({ id: "doc-9", filename: "old.pdf" })]);
    renderPage();

    const row = (await screen.findByText("old.pdf")).closest("li");
    expect(row).not.toBeNull();

    await userEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Delete old.pdf" }),
    );

    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith("doc-9"));
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2));
  });

  it("reports a failed delete", async () => {
    api.listDocuments.mockResolvedValue([doc({ id: "doc-9", filename: "old.pdf" })]);
    api.deleteDocument.mockRejectedValue(new Error("Document is locked."));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Delete old.pdf" }));

    expect(await screen.findByText("Could not delete the document")).toBeInTheDocument();
  });
});
