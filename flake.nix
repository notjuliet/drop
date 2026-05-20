{
  inputs.parts.url = "github:hercules-ci/flake-parts";
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = inp:
    inp.parts.lib.mkFlake {inputs = inp;} {
      systems = ["x86_64-linux"];
      perSystem = {
        lib,
        config,
        pkgs,
        ...
      }: {
        devShells.default = pkgs.mkShell {
          name = "drop-devshell";
          packages = with pkgs; [
            bun
            typescript-language-server
          ];
          shellHook = ''
            export PATH="$PATH:$PWD/node_modules/.bin"
          '';
        };
        packages.drop = pkgs.callPackage ./nix {
          modules = pkgs.callPackage ./nix/modules.nix {};
          webModules = pkgs.callPackage ./nix/web-modules.nix {};
        };
        packages.default = config.packages.drop;
    };
  };
}
