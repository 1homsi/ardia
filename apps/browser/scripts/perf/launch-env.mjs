const LIBRARIES = "DYLD_INSERT_LIBRARIES=";

export function sideLaunchEnv(shared, controlOnly, role, instance = []) {
  const side = [...shared, ...(role === "control" ? controlOnly : [])];
  return {
    extra: [...side, ...instance].filter((e) => !e.startsWith(LIBRARIES)),
    libraries: side.filter((e) => e.startsWith(LIBRARIES)).map((e) => e.slice(LIBRARIES.length)),
  };
}
