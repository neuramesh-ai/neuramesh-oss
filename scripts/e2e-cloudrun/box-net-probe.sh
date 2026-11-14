#!/bin/bash
# run INSIDE the agent box by box-net-probe.mjs (the placeholders are filled in there)
set +e
echo "== id"; id; hostname; uname -a
echo "== /sys/class/net"; for i in /sys/class/net/*; do echo "$(basename $i) $(cat $i/address 2>/dev/null) mtu=$(cat $i/mtu 2>/dev/null) oper=$(cat $i/operstate 2>/dev/null)"; done
echo "== ip"; (ip -4 addr; ip route; ip neigh) 2>&1 | head -40
echo "== /proc/net/route"; cat /proc/net/route
echo "== /proc/net/fib_trie (local)"; awk '/32 host/ {print prev} {prev=$2}' /proc/net/fib_trie 2>/dev/null | sort -u
echo "== /proc/net/arp"; cat /proc/net/arp
echo "== resolv"; cat /etc/resolv.conf
tcp() { s=$(date +%s%N); r=$(timeout 4 bash -c "exec 3<>/dev/tcp/$1/$2" 2>&1 && echo OPEN); rc=$?; e=$(( ($(date +%s%N)-s)/1000000 )); echo "tcp $1:$2 rc=$rc ms=$e ${r:-}" | tr '\n' ' '; echo; }
echo "== tcp to the gateway"
tcp __GW__ __FPORT__
tcp __GW__ 1
tcp __GW__ 22
tcp __GW__ 8080
echo "== tcp elsewhere"
tcp 1.1.1.1 443
tcp 169.254.169.254 80
tcp 10.0.0.1 80
echo "== ping"; (ping -c1 -W2 __GW__ 2>&1 || echo "no ping") | tail -3
echo "== curl"; (curl -sS -m 5 -o /dev/null -w "example.com %{http_code}\n" https://example.com 2>&1 || echo "curl failed") | tail -2
(curl -sS -m 4 -o /dev/null -w "gw-forward %{http_code}\n" http://__GW__:__FPORT__/ 2>&1 || true) | tail -2
echo "== proxy env"; env | grep -i -E '^(https?|no|all)_proxy=' || echo none
