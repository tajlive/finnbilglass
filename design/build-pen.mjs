import { writeFileSync } from "fs";

let counter = 0;
const id = () => "n" + (++counter).toString(36).padStart(4, "0");
const N = (props, children) => {
  const node = { id: id(), ...props };
  if (children) node.children = children;
  return node;
};
const T = (content, props = {}) => N({ type: "text", fontFamily: "$font", fill: "$text-primary", content, ...props });
const F = (props, children) => N({ type: "frame", ...props }, children);

const sec = { fill: "$text-secondary" };

// ---------- Sidebar ----------
const navItems = [
  ["Oversikt", "layout-dashboard", true, 0],
  ["Innboks", "inbox", false, 3],
  ["Saker", "clipboard-list", false, 0],
  ["Katalog", "book-open", false, 0],
  ["Drift", "settings", false, 0],
];

const sidebar = F(
  { name: "Sidebar", layout: "vertical", width: 232, height: "fill_container", fill: "$ink", padding: [24, 0, 20, 0], gap: 28 },
  [
    F({ name: "Logo", layout: "horizontal", padding: [0, 20], gap: 10, alignItems: "center" }, [
      F({ name: "Mark", width: 30, height: 30, cornerRadius: 8, fill: "$teal", layout: "horizontal", justifyContent: "center", alignItems: "center" }, [
        N({ type: "icon", name: "MarkIcon", library: "lucide", icon: "car", width: 16, height: 16, fill: "#ffffff" }),
      ]),
      T("finnbilglass", { fontSize: 17, fontWeight: "700", fill: "#ffffff" }),
    ]),
    F(
      { name: "Nav", layout: "vertical", width: "fill_container", padding: [0, 12], gap: 4 },
      navItems.map(([label, icon, active, badge]) => {
        const kids = [
          N({ type: "icon", name: "Icon", library: "lucide", icon, width: 17, height: 17, fill: active ? "#ffffff" : "#8aa3bd" }),
          T(label, { fontSize: 14, fontWeight: active ? "600" : "500", fill: active ? "#ffffff" : "#b6c6d8" }),
        ];
        if (badge) {
          kids.push(F({ name: "Spacer", width: "fill_container", height: 1 }));
          kids.push(
            F({ name: "Badge", fill: "$amber", cornerRadius: 9, padding: [2, 7], layout: "horizontal" }, [
              T(String(badge), { fontSize: 11, fontWeight: "700", fill: "#10243a" }),
            ])
          );
        }
        const props = { name: "Nav " + label, layout: "horizontal", width: "fill_container", padding: [10, 12], gap: 12, alignItems: "center", cornerRadius: 8 };
        if (active) props.fill = "#1b3a5c";
        return F(props, kids);
      })
    ),
    F({ name: "SideSpacer", width: "fill_container", height: "fill_container" }),
    F({ name: "SideFooter", layout: "horizontal", padding: [0, 20], gap: 10, alignItems: "center" }, [
      N({ type: "icon", name: "HelpIcon", library: "lucide", icon: "life-buoy", width: 16, height: 16, fill: "#8aa3bd" }),
      T("Hjelp og support", { fontSize: 13, fill: "#b6c6d8" }),
    ]),
  ]
);

// ---------- Topbar ----------
const topbar = F(
  { name: "Topbar", layout: "horizontal", width: "fill_container", height: 64, fill: "$card", stroke: "$border", strokeWidth: { bottom: 1 }, padding: [0, 28], gap: 16, alignItems: "center" },
  [
    F({ name: "Search", layout: "horizontal", width: 340, padding: [9, 14], gap: 10, alignItems: "center", fill: "$bg", cornerRadius: 8, stroke: "$border", strokeWidth: 1 }, [
      N({ type: "icon", name: "SearchIcon", library: "lucide", icon: "search", width: 15, height: 15, fill: "#64748b" }),
      T("Søk i saker, kunder eller skilt …", { fontSize: 13, ...sec }),
    ]),
    F({ name: "TopSpacer", width: "fill_container", height: 1 }),
    N({ type: "icon", name: "Bell", library: "lucide", icon: "bell", width: 18, height: 18, fill: "#64748b" }),
    F({ name: "Avatar", width: 32, height: 32, cornerRadius: 16, fill: "$ink", layout: "horizontal", justifyContent: "center", alignItems: "center" }, [
      T("MK", { fontSize: 12, fontWeight: "700", fill: "#ffffff" }),
    ]),
  ]
);

// ---------- KPI cards ----------
const kpis = [
  ["Nye saker", "14", "+3 i dag", "#0f766e"],
  ["Trenger svar", "6", "2 haster", "#b45309"],
  ["Tilbud sendt", "9", "siste 24 t", "#64748b"],
  ["Ubehandlede >12t", "2", "følg opp nå", "#b45309"],
];
const kpiRow = F(
  { name: "KPI Row", layout: "horizontal", width: "fill_container", gap: 16 },
  kpis.map(([label, value, delta, deltaColor]) =>
    F({ name: "KPI " + label, layout: "vertical", width: "fill_container", padding: 20, gap: 8, fill: "$card", cornerRadius: 10, stroke: "$border", strokeWidth: 1 }, [
      T(label, { fontSize: 13, fontWeight: "500", ...sec }),
      T(value, { fontSize: 32, fontWeight: "700" }),
      T(delta, { fontSize: 12, fontWeight: "600", fill: deltaColor }),
    ])
  )
);

// ---------- Table ----------
const cols = [
  ["Sak", 90],
  ["Kunde", "fill_container"],
  ["Skilt", 110],
  ["Status", 140],
  ["Alder", 70],
];
const pill = (label, bg, color) =>
  F({ name: "Pill " + label, layout: "horizontal", padding: [4, 10], cornerRadius: 999, fill: bg }, [
    T(label, { fontSize: 12, fontWeight: "600", fill: color }),
  ]);

const rows = [
  ["#2041", "Bilpleie Nord AS", "EB 12345", ["Ny", "#e6f4f2", "#0f766e"], "12 min"],
  ["#2040", "Svein Håkonsen", "DR 45210", ["Trenger svar", "#fef3c7", "#92400e"], "1 t"],
  ["#2039", "Auto Sør Verksted", "SV 88412", ["Tilbud sendt", "#e8eef7", "#10243a"], "3 t"],
  ["#2038", "Nordmann Bilutleie", "CF 30187", ["Venter kunde", "#f1f5f9", "#64748b"], "7 t"],
  ["#2037", "Fjordline Taxi", "PR 65521", ["Fullført", "#dcfce7", "#15803d"], "14 t"],
];

const cell = (w, child) => F({ name: "Cell", layout: "horizontal", width: w, alignItems: "center" }, [child]);

const tableCard = F(
  { name: "Siste henvendelser", layout: "vertical", width: "fill_container", fill: "$card", cornerRadius: 10, stroke: "$border", strokeWidth: 1, clip: true },
  [
    F({ name: "TableHeader", layout: "horizontal", width: "fill_container", padding: [18, 20], alignItems: "center" }, [
      T("Siste henvendelser", { fontSize: 16, fontWeight: "700" }),
      F({ name: "HSpacer", width: "fill_container", height: 1 }),
      F({ name: "SeAlleBtn", layout: "horizontal", padding: [7, 14], cornerRadius: 8, fill: "$teal" }, [
        T("Se alle saker", { fontSize: 12, fontWeight: "600", fill: "#ffffff" }),
      ]),
    ]),
    F(
      { name: "ColHeader", layout: "horizontal", width: "fill_container", padding: [10, 20], gap: 12, fill: "#f8fafc", stroke: "$border", strokeWidth: { top: 1, bottom: 1 } },
      cols.map(([label, w]) => cell(w, T(label, { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, ...sec })))
    ),
    ...rows.map(([sak, kunde, skilt, [sLabel, sBg, sColor], alder], i) =>
      F(
        { name: "Row " + sak, layout: "horizontal", width: "fill_container", padding: [13, 20], gap: 12, alignItems: "center", stroke: i ? "$border" : undefined, strokeWidth: i ? { top: 1 } : undefined },
        [
          cell(90, T(sak, { fontSize: 13, fontWeight: "600", fill: "#0f766e" })),
          cell("fill_container", T(kunde, { fontSize: 13, fontWeight: "500" })),
          cell(110, T(skilt, { fontSize: 13, fontWeight: "600", letterSpacing: 0.4 })),
          cell(140, pill(sLabel, sBg, sColor)),
          cell(70, T(alder, { fontSize: 13, ...sec })),
        ]
      )
    ),
  ]
);

// ---------- Driftsstatus ----------
const driftItems = [
  ["E-postmottak", "OK"],
  ["Prisberegning", "OK"],
  ["Leverandør-API", "OK"],
  ["SMS-varslinger", "OK"],
];
const driftCard = F(
  { name: "Driftsstatus", layout: "vertical", width: 300, padding: 20, gap: 14, fill: "$card", cornerRadius: 10, stroke: "$border", strokeWidth: 1 },
  [
    T("Driftsstatus", { fontSize: 16, fontWeight: "700" }),
    ...driftItems.map(([label, status]) =>
      F({ name: "Drift " + label, layout: "horizontal", width: "fill_container", gap: 10, alignItems: "center" }, [
        N({ type: "ellipse", name: "Dot", width: 8, height: 8, fill: "#22c55e" }),
        T(label, { fontSize: 14 }),
        F({ name: "DSpacer", width: "fill_container", height: 1 }),
        T(status, { fontSize: 12, fontWeight: "700", fill: "#15803d" }),
      ])
    ),
    F({ name: "DriftDivider", width: "fill_container", height: 1, fill: "$border" }),
    T("Alle systemer operative · oppdatert 12:04", { fontSize: 12, ...sec }),
    F({ name: "DriftLoggBtn", layout: "horizontal", width: "fill_container", padding: [9, 0], cornerRadius: 8, fill: "$teal", justifyContent: "center", alignItems: "center", gap: 8 }, [
      N({ type: "icon", name: "LogIcon", library: "lucide", icon: "activity", width: 14, height: 14, fill: "#ffffff" }),
      T("Se driftslogg", { fontSize: 13, fontWeight: "600", fill: "#ffffff" }),
    ]),
  ]
);

// ---------- Content ----------
const content = F(
  { name: "Content", layout: "vertical", width: "fill_container", height: "fill_container", padding: 28, gap: 24 },
  [
    F({ name: "PageHeader", layout: "horizontal", width: "fill_container", alignItems: "center" }, [
      F({ name: "Titles", layout: "vertical", gap: 4 }, [
        T("Operations Center", { fontSize: 22, fontWeight: "700" }),
        T("Oversikt over henvendelser og drift – tirsdag 24. februar", { fontSize: 13, ...sec }),
      ]),
      F({ name: "PHSpacer", width: "fill_container", height: 1 }),
      F({ name: "NySakBtn", layout: "horizontal", padding: [10, 16], gap: 8, cornerRadius: 8, fill: "$teal", alignItems: "center" }, [
        N({ type: "icon", name: "PlusIcon", library: "lucide", icon: "plus", width: 15, height: 15, fill: "#ffffff" }),
        T("Ny sak", { fontSize: 13, fontWeight: "600", fill: "#ffffff" }),
      ]),
    ]),
    kpiRow,
    F({ name: "BottomRow", layout: "horizontal", width: "fill_container", gap: 24, alignItems: "start" }, [tableCard, driftCard]),
  ]
);

const main = F({ name: "Main", layout: "vertical", width: "fill_container", height: "fill_container" }, [topbar, content]);

const screen = F(
  { name: "Operations Center", x: 0, y: 0, width: 1440, height: 900, layout: "horizontal", fill: "$bg", clip: true },
  [sidebar, main]
);

const doc = {
  version: "2.21",
  variables: {
    ink: { type: "color", value: "#10243a" },
    teal: { type: "color", value: "#0f766e" },
    amber: { type: "color", value: "#f59e0b" },
    bg: { type: "color", value: "#f4f7fb" },
    card: { type: "color", value: "#ffffff" },
    border: { type: "color", value: "#e3e9f1" },
    "text-primary": { type: "color", value: "#10243a" },
    "text-secondary": { type: "color", value: "#64748b" },
    font: { type: "string", value: "system-ui" },
  },
  children: [screen],
};

writeFileSync("/Users/taj/finnbilglass/design/ops-admin-2026.pen", JSON.stringify(doc, null, 2));
console.log("written, nodes:", counter);
