import { labLog } from "@ardia/phone-native";

export { labLog };

export const isLabBuild = process.env.EXPO_PUBLIC_ARDIA_LAB === "true";

let tracing = isLabBuild;
let traceSink: (line: string) => void = labLog;

export function traceLab(on: boolean, sink: (line: string) => void = labLog) {
  tracing = on;
  traceSink = sink;
}

export const labTrace = (line: string) => {
  if (tracing) traceSink(line);
};
