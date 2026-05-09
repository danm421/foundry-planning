// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { z } from "zod";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "client-from-params" }),
}));

const baseArtifact = {
  id: "investments",
  title: "Investments",
  section: "assets" as const,
  route: "/clients/[id]/assets/investments",
  variants: ["chart", "data", "chart+data", "csv"] as const,
  optionsSchema: z.object({ drillDownClasses: z.array(z.string()).default([]) }),
  defaultOptions: { drillDownClasses: [] },
  fetchData: vi.fn(),
  renderPdf: vi.fn(),
  toCsv: vi.fn(),
};

vi.mock("@/lib/report-artifacts/index", () => ({
  getArtifact: (id: string) => (id === "investments" ? baseArtifact : undefined),
  listArtifacts: () => [],
}));

const getRegisteredChartsMock = vi.fn(() => [] as unknown[]);
vi.mock("@/lib/report-artifacts/chart-capture", () => ({
  getRegisteredCharts: (...args: unknown[]) => getRegisteredChartsMock(...args),
}));

import { ExportModal } from "../export-modal";

const renderModal = (overrides?: Partial<Parameters<typeof ExportModal>[0]>) => {
  const onOpenChange = vi.fn();
  const utils = render(
    <ExportModal
      reportId="investments"
      open
      onOpenChange={onOpenChange}
      clientId="c1"
      {...overrides}
    />,
  );
  return { onOpenChange, ...utils };
};

const fakePdfResponse = () => ({
  ok: true,
  status: 200,
  blob: vi.fn().mockResolvedValue(new Blob(["PDF"], { type: "application/pdf" })),
  headers: new Headers({ "content-type": "application/pdf" }),
});

describe("ExportModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegisteredChartsMock.mockReturnValue([]);
    Object.defineProperty(global.URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:mock"),
    });
    Object.defineProperty(global.URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(),
    });
    global.fetch = vi.fn().mockResolvedValue(fakePdfResponse()) as unknown as typeof fetch;
  });

  it("renders the dialog with the artifact's title and all variant labels", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: /export: investments/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/chart only/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/chart \+ data/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/data only \(pdf\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/data only \(csv\)/i)).toBeInTheDocument();
  });

  it("defaults to chart+data when the artifact supports it", () => {
    renderModal();
    expect(screen.getByLabelText<HTMLInputElement>(/chart \+ data/i)).toBeChecked();
  });

  it("renders nothing when open is false", () => {
    render(
      <ExportModal
        reportId="investments"
        open={false}
        onOpenChange={vi.fn()}
        clientId="c1"
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("posts to the right URL when Export is clicked and closes on success", async () => {
    const { onOpenChange } = renderModal();
    fireEvent.click(screen.getByLabelText(/data only \(pdf\)/i));
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/clients/c1/exports/pdf");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ reportId: "investments", variant: "data", charts: [] });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("includes registered charts when variant requires them", async () => {
    getRegisteredChartsMock.mockReturnValue([
      {
        id: "donut",
        dataUrl: "data:image/png;base64,xx",
        width: 800,
        height: 500,
        dataVersion: "v1",
      },
    ]);
    renderModal();
    fireEvent.click(screen.getByLabelText(/chart \+ data/i));
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const init = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.charts).toHaveLength(1);
    expect(body.charts[0].id).toBe("donut");
  });

  it("falls back to params.id when clientId prop is omitted", async () => {
    render(
      <ExportModal reportId="investments" open onOpenChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe("/api/clients/client-from-params/exports/pdf");
  });

  it("surfaces a non-200 response as an error message and does not close", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      blob: vi.fn(),
      headers: new Headers(),
    });
    const { onOpenChange } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await screen.findByText(/export failed \(500\)/i);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("changes the primary button label to Export CSV when csv is selected", () => {
    renderModal();
    act(() => {
      fireEvent.click(screen.getByLabelText(/data only \(csv\)/i));
    });
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
  });

  it("renders a fallback when the reportId is unknown", () => {
    render(
      <ExportModal reportId="unknown" open onOpenChange={vi.fn()} clientId="c1" />,
    );
    expect(screen.getByText(/unknown report: unknown/i)).toBeInTheDocument();
  });
});
