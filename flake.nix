{
  description = "MassivCartAPI dev shell — bun + node 22 + make";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_22
              gnumake
            ];

            shellHook = ''
              if [ ! -d node_modules ]; then
                echo "node_modules missing — running bun install"
                bun install
              fi
              if [ ! -f .env ]; then
                echo "WARNING: .env missing — copy .env.example to .env and fill in values"
              fi
            '';
          };
        });
    };
}
