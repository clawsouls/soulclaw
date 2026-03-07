/**
 * SoulScan Rules — Embedded scan rules for standalone operation.
 * Ported from clawsouls-cli scan-rules.json v1.4.0
 * SOULSCAN™ (40-2026-0033472)
 */

// ─── Types ───────────────────────────────────────────────

export type RuleCategory = "schema" | "file-structure" | "security" | "quality";
export type RuleSeverity = "error" | "warning" | "info";
export type RuleCheck = "pattern" | "manifest" | "cross-reference";

export interface ScanRule {
  id: string;
  category: RuleCategory;
  severity: RuleSeverity;
  description: string;
  pattern?: string;
  check?: RuleCheck;
  condition?: string;
  title?: string;
  recommendation?: string;
  minSpecVersion?: string;
}

export interface ScanRuleSet {
  version: string;
  rules: ScanRule[];
}

// ─── Built-in Rules ──────────────────────────────────────

export const RULES_VERSION = "1.4.0";

export const DEFAULT_RULES: ScanRuleSet = {
  version: RULES_VERSION,
  rules: [
    // ── Security: Prompt Injection ─────────────────────
    {
      id: "SEC001",
      category: "security",
      severity: "error",
      pattern: "ignore\\s+(?:all\\s+)?(?:previous|prior|above)\\s+(?:instructions|prompts)",
      description: "Prompt injection: ignore previous instructions",
    },
    {
      id: "SEC002",
      category: "security",
      severity: "error",
      pattern: "you\\s+are\\s+now\\s+(?:a|an|the)\\s+",
      description: "Prompt injection: forced role change",
    },
    {
      id: "SEC003",
      category: "security",
      severity: "error",
      pattern: "disregard\\s+(?:your|all|previous)",
      description: "Prompt injection: disregard instructions",
    },
    {
      id: "SEC004",
      category: "security",
      severity: "error",
      pattern: "forget\\s+(?:all|your|previous)\\s+(?:instructions|rules|constraints)",
      description: "Prompt injection: forget instructions",
    },
    {
      id: "SEC005",
      category: "security",
      severity: "error",
      pattern: "override\\s+(?:your|all|system)\\s+(?:instructions|rules|settings)",
      description: "Prompt injection: override system",
    },
    {
      id: "SEC006",
      category: "security",
      severity: "error",
      pattern:
        "(?:pretend|act\\s+as\\s+if)\\s+(?:you\\s+)?(?:have\\s+no|don'?t\\s+have)\\s+(?:rules|restrictions|limits)",
      description: "Prompt injection: remove restrictions",
    },
    {
      id: "SEC007",
      category: "security",
      severity: "error",
      pattern: "jailbreak|DAN\\s*mode|do\\s+anything\\s+now",
      description: "Prompt injection: jailbreak attempt",
    },
    {
      id: "SEC008",
      category: "security",
      severity: "error",
      pattern: "\\[system\\]|\\[INST\\]|<<SYS>>|<\\|im_start\\|>",
      description: "Prompt injection: system token injection",
    },

    // ── Security: Code Execution ───────────────────────
    {
      id: "SEC010",
      category: "security",
      severity: "error",
      pattern: "eval\\s*\\(",
      description: "Code execution: eval()",
    },
    {
      id: "SEC011",
      category: "security",
      severity: "error",
      pattern: "exec\\s*\\(",
      description: "Code execution: exec()",
    },
    {
      id: "SEC012",
      category: "security",
      severity: "error",
      pattern: "system\\s*\\(",
      description: "Code execution: system()",
    },
    {
      id: "SEC013",
      category: "security",
      severity: "error",
      pattern: "child_process",
      description: "Code execution: child_process module",
    },
    {
      id: "SEC014",
      category: "security",
      severity: "error",
      pattern: "require\\s*\\(\\s*['\"`](?:fs|net|http|child_process)",
      description: "Code execution: dangerous require",
    },
    {
      id: "SEC015",
      category: "security",
      severity: "error",
      pattern: "import\\s+.*from\\s+['\"`](?:fs|net|http|child_process)",
      description: "Code execution: dangerous import",
    },

    // ── Security: XSS ──────────────────────────────────
    {
      id: "SEC020",
      category: "security",
      severity: "error",
      pattern: "<script[\\s>]",
      description: "XSS: script tag",
    },
    {
      id: "SEC021",
      category: "security",
      severity: "error",
      pattern: "on(?:load|error|click|mouseover)\\s*=",
      description: "XSS: event handler attribute",
    },
    {
      id: "SEC022",
      category: "security",
      severity: "error",
      pattern: "javascript\\s*:",
      description: "XSS: javascript: URI",
    },

    // ── Security: Data Exfil & Secrets ─────────────────
    {
      id: "SEC030",
      category: "security",
      severity: "error",
      pattern: "(?:curl|wget|fetch)\\s+https?:\\/\\/",
      description: "Data exfiltration: external HTTP request",
    },
    {
      id: "SEC031",
      category: "security",
      severity: "error",
      pattern: "(?:api[_-]?key|secret[_-]?key|password|token)\\s*[=:]\\s*['\"`]",
      description: "Secret exposure: hardcoded credential",
    },
    {
      id: "SEC032",
      category: "security",
      severity: "warning",
      pattern: "base64[_-]?(?:encode|decode)|atob|btoa",
      description: "Obfuscation: base64 encoding",
    },

    // ── Security: Privilege Escalation ──────────────────
    {
      id: "SEC040",
      category: "security",
      severity: "error",
      pattern: "sudo\\s+",
      description: "Privilege escalation: sudo command",
    },
    {
      id: "SEC041",
      category: "security",
      severity: "error",
      pattern: "chmod\\s+(?:777|u\\+s)",
      description: "Privilege escalation: dangerous chmod",
    },
    {
      id: "SEC042",
      category: "security",
      severity: "error",
      pattern: "rm\\s+-rf\\s+[\\/~]",
      description: "Destructive command: rm -rf",
    },

    // ── Security: Social Engineering ───────────────────
    {
      id: "SEC050",
      category: "security",
      severity: "warning",
      pattern:
        "(?:send|share|reveal|tell\\s+me)\\s+(?:your|the)\\s+(?:api[_-]?key|password|token|secret|credentials)",
      description: "Social engineering: credential request",
    },
    {
      id: "SEC051",
      category: "security",
      severity: "warning",
      pattern:
        "(?:don'?t|do\\s+not)\\s+(?:tell|inform|alert|notify)\\s+(?:the\\s+)?(?:user|human|operator)",
      description: "Social engineering: hide from user",
    },

    // ── Security: Secrets ──────────────────────────────
    {
      id: "SEC060",
      category: "security",
      severity: "error",
      pattern: "AKIA[0-9A-Z]{16}",
      description: "Secret: AWS Access Key",
    },
    {
      id: "SEC061",
      category: "security",
      severity: "error",
      pattern: "gh[ps]_[A-Za-z0-9_]{36,}",
      description: "Secret: GitHub Token",
    },
    {
      id: "SEC062",
      category: "security",
      severity: "error",
      pattern: "xox[bpras]-[A-Za-z0-9-]+",
      description: "Secret: Slack Token",
    },
    {
      id: "SEC063",
      category: "security",
      severity: "error",
      pattern: "-----BEGIN (?:RSA|EC|PRIVATE) KEY-----",
      description: "Secret: Private Key",
    },
    {
      id: "SEC064",
      category: "security",
      severity: "error",
      pattern: "eyJ[A-Za-z0-9_-]{10,}\\.eyJ",
      description: "Secret: JWT Token",
    },
    {
      id: "SEC065",
      category: "security",
      severity: "error",
      pattern: "npm_[A-Za-z0-9]{36}",
      description: "Secret: npm Token",
    },
    {
      id: "SEC066",
      category: "security",
      severity: "error",
      pattern: "sk-(?:proj-)?[A-Za-z0-9]{20,}",
      description: "Secret: OpenAI API Key",
    },
    {
      id: "SEC067",
      category: "security",
      severity: "error",
      pattern: "SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}",
      description: "Secret: SendGrid API Key",
    },
    {
      id: "SEC068",
      category: "security",
      severity: "error",
      pattern: "sk_live_[A-Za-z0-9]{24,}",
      description: "Secret: Stripe Secret Key",
    },
    {
      id: "SEC069",
      category: "security",
      severity: "warning",
      pattern: "['\"`][A-Za-z0-9]{40,}['\"`]",
      description: "Possible hardcoded secret (40+ chars)",
    },

    // ── Security: i18n Prompt Injection ─────────────────
    {
      id: "SEC070",
      category: "security",
      severity: "error",
      pattern: "이전\\s*지시를\\s*무시",
      description: "Prompt injection (KO): ignore previous instructions",
    },
    {
      id: "SEC071",
      category: "security",
      severity: "error",
      pattern: "모든\\s*규칙을\\s*잊어",
      description: "Prompt injection (KO): forget all rules",
    },
    {
      id: "SEC072",
      category: "security",
      severity: "error",
      pattern: "시스템\\s*프롬프트를\\s*보여",
      description: "Prompt injection (KO): show system prompt",
    },
    {
      id: "SEC073",
      category: "security",
      severity: "error",
      pattern: "忽略之前的指令",
      description: "Prompt injection (ZH): ignore previous instructions",
    },
    {
      id: "SEC074",
      category: "security",
      severity: "error",
      pattern: "忘记所有规则",
      description: "Prompt injection (ZH): forget all rules",
    },
    {
      id: "SEC075",
      category: "security",
      severity: "error",
      pattern: "显示系统提示",
      description: "Prompt injection (ZH): show system prompt",
    },
    {
      id: "SEC076",
      category: "security",
      severity: "error",
      pattern: "以前の指示を無視",
      description: "Prompt injection (JA): ignore previous instructions",
    },
    {
      id: "SEC077",
      category: "security",
      severity: "error",
      pattern: "すべてのルールを忘れて",
      description: "Prompt injection (JA): forget all rules",
    },

    // ── Security: Harmful Content ──────────────────────
    {
      id: "SEC080",
      category: "security",
      severity: "error",
      pattern:
        "\\b(kill|murder|assassinate)\\s+(all|every|the)\\s+(humans?|people|users?|jews?|muslims?|blacks?|whites?)",
      description: "Harmful content: violence targeting groups",
    },
    {
      id: "SEC081",
      category: "security",
      severity: "error",
      pattern: "\\b(white|black|asian|jewish)\\s+supremac",
      description: "Harmful content: supremacist ideology",
    },
    {
      id: "SEC082",
      category: "security",
      severity: "error",
      pattern:
        "\\b(pretend|act|behave)\\s+(to\\s+be|as\\s+if|like)\\s+(you\\s+are\\s+)?(elon\\s+musk|sam\\s+altman|mark\\s+zuckerberg|donald\\s+trump|joe\\s+biden)",
      description: "Harmful content: public figure impersonation",
    },
    {
      id: "SEC083",
      category: "security",
      severity: "warning",
      pattern:
        "\\b(bypass|circumvent|evade|disable)\\s+(safety|content|ethical|moral)\\s+(filter|guard|check|restriction|guideline)",
      description: "Harmful content: safety bypass instruction",
    },
    {
      id: "SEC084",
      category: "security",
      severity: "error",
      pattern:
        "\\b(how\\s+to\\s+)?(make|build|create|synthesize)\\s+(a\\s+)?(bomb|explosive|weapon|poison|drug|meth)",
      description: "Harmful content: dangerous instructions",
    },
    {
      id: "SEC085",
      category: "security",
      severity: "error",
      pattern:
        "\\b(hate|despise|exterminate)\\s+(all\\s+)?(women|men|gay|lesbian|trans|disabled|immigrants?)",
      description: "Harmful content: hate speech targeting demographics",
    },
    {
      id: "SEC086",
      category: "security",
      severity: "warning",
      pattern:
        "\\byou\\s+must\\s+(always|never)\\s+(lie|deceive|manipulate|mislead)\\s+(the\\s+)?user",
      description: "Harmful content: deception instruction",
    },
    {
      id: "SEC087",
      category: "security",
      severity: "error",
      pattern: "\\b(child|minor|underage)\\s+(porn|sexual|abuse|exploit)",
      description: "Harmful content: CSAM-related",
    },
    {
      id: "SEC088",
      category: "security",
      severity: "warning",
      pattern: "\\b(phishing|scam|fraud)\\s+(email|message|template|script)",
      description: "Harmful content: fraud/scam template",
    },
    {
      id: "SEC089",
      category: "security",
      severity: "warning",
      pattern: "\\bno\\s+(ethical|moral|safety)\\s+(constraints?|guidelines?|boundaries|limits?)",
      description: "Harmful content: no ethical constraints declaration",
    },

    // ── Security: Self-modification ────────────────────
    {
      id: "SEC090",
      category: "security",
      severity: "error",
      pattern:
        "\\b(update|modify|edit|rewrite|overwrite|change|alter)\\s+(your\\s+)?(CLAUDE\\.md|SOUL\\.md|IDENTITY\\.md|AGENTS\\.md|\\.cursorrules|\\.windsurfrules|system\\s*prompt|persona\\s*file|instructions?\\s*file|config\\s*file)",
      description: "Self-modification: instructs agent to modify its own persona/config files",
    },
    {
      id: "SEC091",
      category: "security",
      severity: "warning",
      pattern:
        "\\b(rewrite|update|modify|edit)\\s+(your|the|my)\\s+(instructions?|config(uration)?|persona|identity|behavior|system\\s*prompt)",
      description: "Self-modification: instructs agent to alter its own behavior configuration",
    },

    // ── Security: Embodied Agent (manifest checks) ─────
    {
      id: "SEC100",
      category: "security",
      severity: "warning",
      check: "manifest",
      description:
        "Embodied souls (environment: embodied) should declare safety.laws with hierarchical safety rules.",
      recommendation: "Add safety.laws array with priority-ordered safety rules to your soul.json.",
    },
    {
      id: "SEC101",
      category: "security",
      severity: "warning",
      check: "manifest",
      description: "Embodied souls should have at least a priority-0 or priority-1 safety law.",
      recommendation: "Add a priority-0 or priority-1 safety law addressing human harm prevention.",
    },
    {
      id: "SEC102",
      category: "security",
      severity: "error",
      check: "cross-reference",
      description: "Behavioral rules in persona files contradict declared safety.laws.",
      recommendation: "Align persona behavioral rules with declared safety.laws.",
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────

/** Get pattern-based rules only */
export function getPatternRules(rules: ScanRule[]): ScanRule[] {
  return rules.filter((r) => r.pattern != null);
}

/** Get manifest-based rules only */
export function getManifestRules(rules: ScanRule[]): ScanRule[] {
  return rules.filter((r) => r.check === "manifest" || r.check === "cross-reference");
}

/** Filter rules by category */
export function getRulesByCategory(rules: ScanRule[], category: RuleCategory): ScanRule[] {
  return rules.filter((r) => r.category === category);
}
