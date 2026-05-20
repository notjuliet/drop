{
  lib,
  stdenv,
  bun,
}:
stdenv.mkDerivation {
  name = "modules";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
    ];
  };

  nativeBuildInputs = [bun];

  outputHash = "sha256-fsXrtXX9bp2NJHHSAjZ3ZCA2OogCWpgNkovhid9cBnI=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";

  dontConfigure = true;
  dontCheck = true;
  dontFixup = true;

  buildPhase = ''
    HOME=$TMPDIR bun install --no-cache --no-progress --frozen-lockfile
  '';
  installPhase = ''
    cp -R node_modules $out
    ls -la $out
  '';
}
