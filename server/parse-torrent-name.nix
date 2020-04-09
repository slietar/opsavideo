{ lib, buildPythonPackage, fetchPypi }:
buildPythonPackage rec {
  pname = "parse-torrent-name";
  version = "1.1.1";
  src = fetchPypi {
    inherit pname version;
    sha256 = "1i1ixk07drvibgffr7r3f3n24g9fjr2xijwnrvgf1pi7kyfzm9md";
  };

  doCheck = false;
}
