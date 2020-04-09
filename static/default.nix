{ pkgs ? import <nixpkgs> {}, NODE_ENV ? "production" }:
let
  pname = "opsa-video-static";
  version = "0.0.1";
  inherit (pkgs.yarn2nix-moretea) mkYarnModules;
  deps = mkYarnModules {
    inherit pname version;
    name = "${pname}-modules";
    packageJSON = ./package.json;
    yarnLock = ./yarn.lock;
  };
in
pkgs.stdenv.mkDerivation {
  inherit pname version NODE_ENV;
  src = pkgs.nix-gitignore.gitignoreSource []  ./.;

  nativeBuildInputs = with pkgs; [ yarn ];
  configurePhase = ''
    export HOME=$PWD/yarn_home
    ln -s ${deps}/node_modules node_modules
  '';
  buildPhase = "yarn build";
  installPhase = ''
    mkdir -p $out
    cp -a dist/* $out
  '';
}
