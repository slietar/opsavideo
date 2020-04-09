{ NODE_ENV ? "production", lib, stdenv, yarn2nix-moretea, yarn }:
let
  pname = "opsa-video-static";
  version = "0.0.1";
  inherit (yarn2nix-moretea) mkYarnModules;
  deps = mkYarnModules {
    inherit pname version;
    name = "${pname}-modules";
    packageJSON = ./package.json;
    yarnLock = ./yarn.lock;
  };
in
stdenv.mkDerivation rec {
  inherit pname version NODE_ENV;
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: type: baseNameOf path != "node_modules";
  };

  nativeBuildInputs = [ yarn ];
  configurePhase = ''
    find $src
    export HOME=$PWD/yarn_home
    ln -s ${deps}/node_modules node_modules
  '';
  buildPhase = "yarn build";
  installPhase = ''
    mkdir -p $out
    cp -a dist/* $out
  '';
}
