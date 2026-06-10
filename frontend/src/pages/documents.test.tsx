import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DocumentsPage from "./documents";

const mocks = vi.hoisted(() => ({
  useDocuments: vi.fn(),
  useDocument: vi.fn(),
  useUploadDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
  useProcessDocument: vi.fn(),
}));

vi.mock("@/lib/ocr-queries", () => ({
  useDocuments: mocks.useDocuments,
  useDocument: mocks.useDocument,
  useUploadDocument: mocks.useUploadDocument,
  useDeleteDocument: mocks.useDeleteDocument,
  useProcessDocument: mocks.useProcessDocument,
}));

beforeEach(() => {
  mocks.useDocuments.mockReturnValue({
    data: [
      { id: "doc-1", original_filename: "referral.pdf", content_type: "application/pdf", status: "extracted", created_at: "2026-06-10T00:00:00Z" },
      { id: "doc-2", original_filename: "labs.png", content_type: "image/png", status: "extracting", created_at: "2026-06-10T00:00:00Z" },
    ],
  });
  mocks.useDocument.mockReturnValue({ data: undefined });
  mocks.useUploadDocument.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  mocks.useDeleteDocument.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  mocks.useProcessDocument.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
});

afterEach(() => cleanup());

describe("DocumentsPage", () => {
  it("lists documents with status labels", () => {
    render(
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("referral.pdf")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("labs.png")).toBeInTheDocument();
    expect(screen.getByText("Extracting…")).toBeInTheDocument();
  });

  it("prompts to select a document when none is chosen", () => {
    render(
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Select a document/)).toBeInTheDocument();
  });
});
