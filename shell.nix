{ pkgs ? import <nixpkgs> {}, NODE_ENV ? "development" }:

let
  pkgs = import <nixpkgs> {};
  server = pkgs.callPackage ./server {};
  static = pkgs.callPackage ./static {};
in server.overrideAttrs (old: {
  inherit NODE_ENV;
  nativeBuildInputs = old.nativeBuildInputs ++ static.nativeBuildInputs;
})
