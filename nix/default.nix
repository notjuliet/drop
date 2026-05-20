{
  lib,
  stdenv,
  bun,
  makeBinaryWrapper,
  modules,     # server node_modules
  webModules,  # web/node_modules (separate fetch)
}:

stdenv.mkDerivation {
  pname = "drop";
  version = "main";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../src
      ../web/package.json
      ../web/bun.lock
      ../web/index.html
      ../web/src
      ../web/public
      ../web/vite.config.ts
      ../web/tsconfig.json
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

    cp -R --no-preserve=ownership,mode ${webModules} web/node_modules
    find web/node_modules -type d -exec chmod 755 {} \;
    find web/node_modules/.bin -exec chmod 755 {} \;
    substituteInPlace web/node_modules/.bin/vite \
      --replace-fail "/usr/bin/env node" "${bun}/bin/bun --bun"

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    HOME=$TMPDIR ${bun}/bin/bun run --cwd web build

    HOME=$TMPDIR ${bun}/bin/bun build \
      --target bun \
      --outfile server.js \
      src/index.ts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/web
    cp server.js $out/server.js
    cp -r web/dist $out/web/dist

    substituteInPlace $out/server.js \
      --replace-fail '"./web/dist"'       '"'$out'/web/dist"' \
      --replace-fail '"web/dist/index.html"' '"'$out'/web/dist/index.html"'

    makeBinaryWrapper ${bun}/bin/bun $out/bin/drop \
      --add-flags "run --no-install $out/server.js"

    runHook postInstall
  '';
}
