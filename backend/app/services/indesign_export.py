"""Export a proposal as Adobe InDesign Tagged Text.

Kali Places this .txt into her own KBID InDesign template; the <pstyle:...> tags
map to paragraph styles she keeps in the template (rename them to match hers once,
or import as-is). This is the "use their real template" path for the final signed
PDF — the tool produces correct, KBID-voice content; her InDesign layout is untouched.

Reference: InDesign Tagged Text — first line declares the encoding; each paragraph
begins with <pstyle:NAME>; \\, < and > are escaped; \\t is a tab.
"""
from __future__ import annotations

_SMART = [("“", '"'), ("”", '"'), ("‘", "'"), ("’", "'"),
          ("—", "-"), ("–", "-"), ("…", "...")]


def _esc(s: str) -> str:
    s = s or ""
    for a, b in _SMART:
        s = s.replace(a, b)
    return s.replace("\\", "\\\\").replace("<", "\\<").replace(">", "\\>")


def _money(n) -> str:
    try:
        return "$" + format(int(round(float(n))), ",")
    except Exception:
        return str(n)


def build_tagged_text(sec: dict) -> str:
    meta = sec.get("meta", {})
    firm = meta.get("firm", {})
    out: list[str] = ["<ASCII-WIN>"]

    def p(style: str, text: str = "") -> None:
        out.append(f"<pstyle:{style}>{_esc(text)}")

    def fee(label: str, amount: str | None) -> None:
        p("KBID_Fee", f"{label}\t{amount}" if amount is not None else label)

    # cover
    p("KBID_Label", f"DESIGNER: {firm.get('name','')}")
    for line in (firm.get("address"), firm.get("city"), firm.get("email"), firm.get("phone")):
        p("KBID_Address", line or "")
    p("KBID_Label", f"CLIENT: {meta.get('client_name','')}")
    for line in (meta.get("client_address"), meta.get("client_phone"), meta.get("client_email")):
        if line:
            p("KBID_Address", line)
    p("KBID_Label", meta.get("date", ""))
    p("KBID_Label", f"RE: {meta.get('re','')}")
    if meta.get("project_address"):
        p("KBID_Address", meta["project_address"])
    p("KBID_Body", f"Dear {meta.get('client_contact') or meta.get('client_name','')},")
    p("KBID_Body", sec.get("cover_opener", ""))
    for para in (sec.get("cover_body") or []):
        p("KBID_Body", para)
    p("KBID_Body", "Sincerely,")
    p("KBID_Body", "Kali Buchanan, RID, NCIDQ, IIDA, LEED AP")

    # interior
    p("KBID_Title", "Project Scope & Fees")
    if sec.get("scope_overview"):
        p("KBID_Body", sec["scope_overview"])
    for ph in sec.get("phases", []):
        p("KBID_Subhead", ph.get("name", ""))
        p("KBID_Body", ph.get("description", ""))
    p("KBID_Subhead", "Additional Terms & Conditions")
    p("KBID_Body", sec.get("terms", ""))
    p("KBID_Subhead", "Exclusions, Qualifications, or Exceptions")
    p("KBID_Body", "KBID excludes from its services as well as states as qualifications and exceptions the following.")
    for x in sec.get("exclusions", []):
        p("KBID_Bullet", x)
    if sec.get("schedule"):
        p("KBID_Subhead", "Schedule")
        p("KBID_Body", sec["schedule"])

    # fees
    est = sec.get("estimate") or {}
    phases = est.get("phases") or []
    cons = {k: v for k, v in (sec.get("consultants") or {}).items() if v not in ("", None)}
    p("KBID_Subhead", "Fees & Reimbursable Expenses")
    if sec.get("fee_mode") == "hourly":
        p("KBID_MiniHead", "Estimated Hourly Fee Range")
        lo_sum = hi_sum = 0
        for ph in phases:
            base = ph.get("total_rounded") or ph.get("total_raw") or 0
            lo = int(round(base / 1000.0) * 1000); hi = lo + 2000
            lo_sum += lo; hi_sum += hi
            hrs = int(round(ph.get("hours") or 0))
            fee(f"{ph['name']} ({hrs} Hours / {ph.get('duration_weeks')} weeks)", f"{_money(lo)} - {_money(hi)}")
        fee("Construction Observation", "Hourly As Needed")
        fee("Total", f"{_money(lo_sum)} - {_money(hi_sum)}")
        if cons.get("Structural"):
            fee("Allowance for Structural Engineer", _money(cons["Structural"]))
    else:
        p("KBID_MiniHead", "Interior Design Fee Breakdown")
        total = 0
        for ph in phases:
            amt = ph.get("total_rounded") or ph.get("total_raw") or 0
            total += amt
            fee(ph["name"], _money(amt))
        for label, key in (("MEP Engineering Fee Allowance", "MEP"), ("Structural Engineering Allowance", "Structural")):
            if cons.get(key):
                total += float(cons[key]); fee(label, _money(cons[key]))
        fee("Total Design Fee", _money(total))
    p("KBID_MiniHead", "Interior Design Rate Table")
    for label, rate in (("Owner", 210), ("Design Director", 200), ("Interior Designer", 170), ("Designer", 150)):
        fee(label, f"${rate} / hr")

    # standard closing sections
    p("KBID_Subhead", "Payment"); p("KBID_Body", sec.get("payment", ""))
    p("KBID_Subhead", "Reimbursable Expenses")
    for x in sec.get("reimbursables", []):
        p("KBID_Bullet", x)
    p("KBID_Subhead", "Documents & Photographs"); p("KBID_Body", sec.get("documents", ""))
    p("KBID_Subhead", "Limitation on Liability"); p("KBID_Body", sec.get("limitation", ""))
    p("KBID_Subhead", "Notice to Proceed"); p("KBID_Body", sec.get("notice", ""))
    if sec.get("cover_closer"):
        p("KBID_Body", sec["cover_closer"])

    return "\r\n".join(out) + "\r\n"
