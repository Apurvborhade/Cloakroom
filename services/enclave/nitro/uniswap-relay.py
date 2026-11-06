"""Fixed Uniswap TLS relay."""
from https_relay import run

if __name__ == "__main__":
    run(host="trade-api.gateway.uniswap.org", port=8002, socket_name="\0cloakroom-uniswap")
