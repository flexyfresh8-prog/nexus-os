// NEXUS OS — calculator expression engine.
// A real recursive-descent parser (no eval, no Function): numbers with
// decimal/exponent forms, + - * / % ^, unary minus, parentheses, constants
// (pi, e), and a small function set (sqrt, sin, cos, tan, log, ln, abs, round,
// floor, ceil). Angles for trig are degrees by default (deg flag switches).

export interface EvalResult {
  value: number;
  error?: undefined;
}

export interface EvalError {
  value?: undefined;
  error: string;
}

type Token =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" };

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

export const CALC_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

export const CALC_FUNCS = Object.keys(FUNCS);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === ",") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === "e" || s[j] === "E") {
        let k = j + 1;
        if (s[k] === "+" || s[k] === "-") k++;
        if (/[0-9]/.test(s[k] ?? "")) {
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          j = k;
        }
      }
      const text = s.slice(i, j);
      const v = Number(text);
      if (!Number.isFinite(v)) throw new Error(`Invalid number "${text}"`);
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z_0-9]/.test(s[j])) j++;
      tokens.push({ t: "ident", v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/%^".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parseExpression(): number {
    const v = this.parseAdditive();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token at position ${this.pos}`);
    }
    return v;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    for (;;) {
      const tk = this.peek();
      if (tk?.t === "op" && (tk.v === "+" || tk.v === "-")) {
        this.next();
        const right = this.parseMultiplicative();
        left = tk.v === "+" ? left + right : left - right;
      } else break;
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parsePower();
    for (;;) {
      const tk = this.peek();
      if (tk?.t === "op" && (tk.v === "*" || tk.v === "/" || tk.v === "%")) {
        this.next();
        const right = this.parsePower();
        if (tk.v === "*") left *= right;
        else if (tk.v === "/") {
          if (right === 0) throw new Error("Division by zero");
          left /= right;
        } else {
          if (right === 0) throw new Error("Division by zero (modulo)");
          left %= right;
        }
      } else if (tk && (tk.t === "num" || tk.t === "ident" || tk.t === "lp")) {
        // implicit multiplication: 2pi, 3(4+1), (2)(3)
        const right = this.parsePower();
        left *= right;
      } else break;
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    const tk = this.peek();
    if (tk?.t === "op" && tk.v === "^") {
      this.next();
      const exp = this.parsePower(); // right-associative
      const v = Math.pow(base, exp);
      if (!Number.isFinite(v)) throw new Error("Result out of range");
      return v;
    }
    return base;
  }

  private parseUnary(): number {
    const tk = this.peek();
    if (tk?.t === "op" && tk.v === "-") {
      this.next();
      return -this.parseUnary();
    }
    if (tk?.t === "op" && tk.v === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const tk = this.next();
    if (!tk) throw new Error("Unexpected end of expression");
    if (tk.t === "num") return tk.v;
    if (tk.t === "lp") {
      const v = this.parseAdditive();
      const close = this.next();
      if (!close || close.t !== "rp") throw new Error("Missing closing parenthesis");
      return v;
    }
    if (tk.t === "ident") {
      const name = tk.v;
      // implicit multiplication: 2pi, 3sqrt(4)
      const next = this.peek();
      const callNext = next && next.t === "lp";
      if (name in FUNCS && callNext) {
        this.next(); // consume lp
        const arg = this.parseAdditive();
        const close = this.next();
        if (!close || close.t !== "rp") throw new Error(`Missing closing parenthesis after ${name}(`);
        const v = FUNCS[name](arg);
        if (!Number.isFinite(v)) throw new Error(`${name}() produced a non-finite result`);
        return v;
      }
      if (name in CALC_CONSTANTS) {
        return CALC_CONSTANTS[name];
      }
      if (name in FUNCS && !callNext) {
        // allow `sqrt 9` style
        const arg = this.parseUnary();
        const v = FUNCS[name](arg);
        if (!Number.isFinite(v)) throw new Error(`${name}() produced a non-finite result`);
        return v;
      }
      throw new Error(`Unknown name "${name}"`);
    }
    throw new Error("Unexpected token in expression");
  }
}

/** Evaluate an arithmetic expression. Throws Error with a human message. */
export function evaluateExpression(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty expression");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error("Empty expression");
  const value = new Parser(tokens).parseExpression();
  if (!Number.isFinite(value)) throw new Error("Result is not a finite number");
  return value;
}

/** Format a result for display: up to 12 significant digits, no trailing zeros. */
export function formatCalcResult(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const s = v.toPrecision(12).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
