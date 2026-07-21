// Mirrors the odata2ts project standard (printWidth 120, sorted imports, formatted package.json).
// The XML plugin used there is omitted - this repo has no XML sources.
export default {
  plugins: ["prettier-plugin-packagejson", "@ianvs/prettier-plugin-sort-imports"],
  printWidth: 120,
  tabWidth: 2,
  semi: true,
};
