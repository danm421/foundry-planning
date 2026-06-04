import {
  sectionKeyForPath,
  pushLocation,
  popTop,
  labelForSection,
  type TrailEntry,
} from "./back-nav";

describe("sectionKeyForPath", () => {
  it("keys a client subpage by client id", () => {
    expect(sectionKeyForPath("/clients/abc/assets")).toBe("client:abc");
  });
  it("keys the bare client page by client id", () => {
    expect(sectionKeyForPath("/clients/abc")).toBe("client:abc");
  });
  it("keys the clients list distinctly from a client", () => {
    expect(sectionKeyForPath("/clients")).toBe("clients");
  });
  it("keys a top-level section by its first segment", () => {
    expect(sectionKeyForPath("/cma")).toBe("cma");
  });
  it("keys the root path as 'root'", () => {
    expect(sectionKeyForPath("/")).toBe("root");
  });
});

describe("pushLocation", () => {
  it("replaces the top entry when staying in the same section (collapses subtabs)", () => {
    const t0 = pushLocation([], { sectionKey: "client:a", href: "/clients/a/overview" });
    const t1 = pushLocation(t0, { sectionKey: "client:a", href: "/clients/a/assets" });
    expect(t1).toEqual([{ sectionKey: "client:a", href: "/clients/a/assets" }]);
  });
  it("pushes a new entry when entering a different section", () => {
    const t0 = pushLocation([], { sectionKey: "client:a", href: "/clients/a/assets" });
    const t1 = pushLocation(t0, { sectionKey: "cma", href: "/cma" });
    expect(t1).toEqual([
      { sectionKey: "client:a", href: "/clients/a/assets" },
      { sectionKey: "cma", href: "/cma" },
    ]);
  });
  it("caps the trail length, dropping the oldest", () => {
    let t: TrailEntry[] = [];
    for (let i = 0; i < 10; i++) {
      t = pushLocation(t, { sectionKey: `s${i}`, href: `/${i}` }, 8);
    }
    expect(t).toHaveLength(8);
    expect(t[0].sectionKey).toBe("s2");
  });
});

describe("popTop", () => {
  it("removes the last entry", () => {
    expect(
      popTop([
        { sectionKey: "a", href: "/a" },
        { sectionKey: "b", href: "/b" },
      ]),
    ).toEqual([{ sectionKey: "a", href: "/a" }]);
  });
  it("is a no-op on an empty trail", () => {
    expect(popTop([])).toEqual([]);
  });
});

describe("back-navigation invariant", () => {
  it("pop-then-retrack keeps the trail stable", () => {
    // client:a (assets) -> cma
    let t = pushLocation([], { sectionKey: "client:a", href: "/clients/a/assets" });
    t = pushLocation(t, { sectionKey: "cma", href: "/cma" });
    // user clicks back: pop cma, then the nav effect re-tracks the client page
    t = popTop(t);
    t = pushLocation(t, { sectionKey: "client:a", href: "/clients/a/assets" });
    expect(t).toEqual([{ sectionKey: "client:a", href: "/clients/a/assets" }]);
  });
});

describe("labelForSection", () => {
  it("prefers a registered label", () => {
    expect(labelForSection("client:a", { "client:a": "Steve Martin" })).toBe("Steve Martin");
  });
  it("falls back to the static section label", () => {
    expect(labelForSection("cma", {})).toBe("CMA's");
    expect(labelForSection("clients", {})).toBe("Clients");
  });
  it("falls back to 'Client' for an unlabeled client section", () => {
    expect(labelForSection("client:a", {})).toBe("Client");
  });
});
