/**
 * A tiny, deterministic "agent" for trying casebook without an API key (TypeScript edition).
 * Same behaviour as agent.py, including its one deliberate bug.
 */
// In your own project: import { result } from "@sharan1712/casebook";
import { result } from "../../typescript/src/index.ts";

const UNITS: Record<string, string> = {
  km: "km", kilometre: "km", kilometres: "km", kilometer: "km", kilometers: "km",
  mi: "mi", mile: "mi", miles: "mi",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  c: "C", celsius: "C", f: "F", fahrenheit: "F",
};

const REQUEST = /(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s+(?:to|in|into)\s+([a-zA-Z]+)/i;

/** The "tool" the agent calls. */
export function convert(value: number, src: string, dst: string): number {
  const pair = `${src}>${dst}`;
  if (pair === "km>mi") return value * 0.621371;
  if (pair === "mi>km") return value / 0.621371;
  if (pair === "kg>lb") return value * 2.20462;
  if (pair === "lb>kg") return value / 2.20462;
  if (pair === "C>F") return (value * 9) / 5 + 32;
  if (pair === "F>C") return value - (32 * 5) / 9; // bug: should be (value - 32) * 5 / 9
  throw new Error(`no conversion from ${src} to ${dst}`);
}

const g = (n: number): string => String(Number(n.toPrecision(6)));

export function agent(request: string) {
  const match = REQUEST.exec(request);
  if (!match) return result({ text: "Sorry, I can't tell what to convert. Try 'Convert 10 km to miles'." });

  const value = Number(match[1]);
  const srcWord = match[2]!.toLowerCase();
  const dstWord = match[3]!.toLowerCase();
  const src = UNITS[srcWord];
  const dst = UNITS[dstWord];
  if (!src || !dst) return result({ text: `Sorry, I can't convert ${!src ? srcWord : dstWord} yet.` });

  let converted: number;
  try {
    converted = Math.round(convert(value, src, dst) * 1000) / 1000;
  } catch {
    return result({ text: `Sorry, I can't convert ${src} to ${dst}.` });
  }
  return result(
    { value: converted, unit: dst, text: `${g(value)} ${src} is ${g(converted)} ${dst}.` },
    {
      tool_calls: [{ name: "convert", input: { value, from: src, to: dst }, output: converted }],
      meta: { agent: "unit-converter", version: "0.1" },
    },
  );
}
