// `import path from "./x.so" with { type: "file" }` gives the file path (a /$bunfs/ path once compiled).
declare module "*.so" {
  const path: string;
  export default path;
}

declare module "*.sha256" {
  const path: string;
  export default path;
}

declare module "*.dll" {
  const path: string;
  export default path;
}
