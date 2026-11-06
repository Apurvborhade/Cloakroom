"""RPC TLS relay; the parent needs only the public hostname, never the API key."""
from https_relay import run

if __name__ == "__main__":
    run(port=8003, socket_name="\0cloakroom-rpc")
