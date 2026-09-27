// the renderer is built by Vite (electron-vite), so it takes Vite's client types: CSS modules,
// asset imports, import.meta.env. the web bridge's entry carried this reference for the whole
// program until hq split out (2026-09-26); the desktop renderer now carries its own.
/// <reference types="vite/client" />
