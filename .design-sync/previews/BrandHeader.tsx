import { BrandHeader, SidebarProvider } from "foundry-planning";

export function Expanded() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="bg-card-2 border border-hair" style={{ width: 280 }}>
        <SidebarProvider initialCollapsed={false}>
          <BrandHeader firmName="Westford Wealth Partners" />
        </SidebarProvider>
      </div>
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="bg-card-2 border border-hair" style={{ width: 72 }}>
        <SidebarProvider initialCollapsed={true}>
          <BrandHeader firmName="Westford Wealth Partners" />
        </SidebarProvider>
      </div>
    </div>
  );
}
