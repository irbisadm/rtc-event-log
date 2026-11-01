import typescript from "@rollup/plugin-typescript";
import {nodeResolve} from "@rollup/plugin-node-resolve";
import dts from "rollup-plugin-dts";

export default [
  {
    input: "src/index.ts",
    output: {file: "dist/index.mjs", format: "es"},
    external: [/^@bufbuild\/protobuf/],
    plugins: [nodeResolve(), typescript({tsconfig: "./tsconfig.json", declaration: false, include: ["src/**/*.ts"]})],
  },
  {
    input: "src/index.ts",
    output: {file: "types/index.d.ts", format: "es"},
    plugins: [dts()],
  },
];
