{
  lib,
  stdenv,
  bun,
}:
stdenv.mkDerivation {
  name = "modules";

  src = lib.fileset.toSource {
    root = ../web;
    fileset = lib.fileset.unions [
      ../web/package.json
      ../web/bun.lock
    ];
  };

  nativeBuildInputs = [bun];

  outputHash = "sha256-cRu2pxzfq3PIppiKMJ7RxU3ydKSrILmHGKcyrr9yFSo=";
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
