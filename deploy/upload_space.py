"""Create (if needed) and upload the Hugging Face Space from deploy/build/space.

Reads the access token from deploy/build/hf_token.txt (git-ignored) so it never appears on the command line.
Usage:  backend\\.venv\\Scripts\\python deploy\\upload_space.py [space-name]
"""
import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent
TOKEN_FILE = ROOT / "build" / "hf_token.txt"
BUNDLE = ROOT / "build" / "space"


def main():
    if not TOKEN_FILE.exists():
        sys.exit(f"Token file not found: {TOKEN_FILE}")
    token = TOKEN_FILE.read_text().strip()
    name = sys.argv[1] if len(sys.argv) > 1 else "megaasset-agentic"
    api = HfApi(token=token)
    user = api.whoami()["name"]
    repo_id = f"{user}/{name}"
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True, private=False)
    api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=str(BUNDLE),
                      commit_message="Deploy MegaAsset-Agentic", delete_patterns=["*"])
    slug = repo_id.replace("/", "-").replace("_", "-").lower()
    print(f"space: https://huggingface.co/spaces/{repo_id}")
    print(f"app:   https://{slug}.hf.space")


if __name__ == "__main__":
    main()
