{
  lib,
  stdenv,
  bun,
  makeBinaryWrapper,
  modules,
}:

stdenv.mkDerivation {
  pname = "drop";
  version = "main";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../.npmrc
      ../index.html
      ../public
      ../src
      ../vite.config.ts
      ../tsconfig.json
    ];
  };

  nativeBuildInputs = [ bun makeBinaryWrapper ];
  buildInputs = [ stdenv.cc.cc.lib ];
  dontCheck = true;

  configurePhase = ''
    runHook preConfigure

    cp -R --no-preserve=ownership,mode ${modules} node_modules
    find node_modules -type d -exec chmod 755 {} \;
    find node_modules/.bin -exec chmod 755 {} \;

    substituteInPlace node_modules/.bin/vite \
      --replace-fail "/usr/bin/env node" "${bun}/bin/bun --bun"

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    HOME=$TMPDIR ${bun}/bin/bun run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/dist
    cp -r dist/client $out/dist/client
    cp -r dist/server $out/dist/server

    makeBinaryWrapper ${bun}/bin/bun $out/bin/drop \
      --chdir "$out" \
      --add-flags "run --no-install $out/dist/server/index.js"

    runHook postInstall
  '';
}
