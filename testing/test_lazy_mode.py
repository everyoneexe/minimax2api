"""
测试 Lazy Mode
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
import time


LAZY_SERVER_URL = "http://localhost:5005"


def test_lazy_server_running():
    """测试Lazy Server是否运行"""
    print("=" * 60)
    print("测试: Lazy Server运行状态")
    print("=" * 60)

    try:
        resp = requests.get(f"{LAZY_SERVER_URL}/status", timeout=5)

        if resp.status_code != 200:
            print(f"❌ Lazy server返回错误状态码: {resp.status_code}")
            return False

        data = resp.json()
        print(f"✓ Lazy Server运行中")
        print(f"  - 可用Tabs: {data.get('tabs_available', 0)}")
        print(f"  - 总Tabs: {data.get('tabs_total', 0)}")
        print(f"  - 账户数: {data.get('accounts', 0)}")

        if data.get('emails'):
            print(f"  - 账户列表:")
            for email in data['emails']:
                print(f"    • {email}")

        if data.get('tabs_total', 0) == 0:
            print(f"⚠️  没有可用tabs - lazy server可能还在初始化")
            return None

        if data.get('tabs_available', 0) == 0:
            print(f"⚠️  所有tabs都在使用中")
            return None

        return True

    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到Lazy Server ({LAZY_SERVER_URL})")
        print(f"   请先启动: cd generator && node lazy_server.js")
        return None
    except Exception as e:
        print(f"❌ Lazy Server状态检查失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_lazy_chat():
    """测试Lazy Server聊天功能"""
    print("\n" + "=" * 60)
    print("测试: Lazy Server聊天")
    print("=" * 60)

    try:
        payload = {"message": "Hello, this is a test!"}

        print(f"发送测试消息...")
        resp = requests.post(
            f"{LAZY_SERVER_URL}/chat",
            json=payload,
            timeout=60
        )

        if resp.status_code != 200:
            print(f"❌ 聊天请求失败: {resp.status_code}")
            print(f"   响应: {resp.text}")
            return False

        data = resp.json()

        if "error" in data:
            print(f"❌ Lazy Server返回错误: {data['error']}")
            return False

        content = data.get("content", "")
        account_email = data.get("account_email", "")

        print(f"✓ 聊天成功")
        print(f"  - 账户: {account_email}")
        print(f"  - 响应长度: {len(content)} 字符")
        print(f"  - 响应预览: {content[:100]}...")

        if "usage" in data:
            usage = data["usage"]
            print(f"  - Token使用:")
            print(f"    • Prompt: {usage.get('prompt_tokens', 0)}")
            print(f"    • Completion: {usage.get('completion_tokens', 0)}")
            print(f"    • Total: {usage.get('total_tokens', 0)}")

        return True

    except requests.exceptions.Timeout:
        print(f"❌ 请求超时 (60秒)")
        return False
    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到Lazy Server")
        return None
    except Exception as e:
        print(f"❌ 聊天测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_lazy_concurrent():
    """测试Lazy Mode并发能力"""
    print("\n" + "=" * 60)
    print("测试: Lazy Mode并发")
    print("=" * 60)

    try:
        # 先检查可用tabs
        status_resp = requests.get(f"{LAZY_SERVER_URL}/status", timeout=5)
        if status_resp.status_code != 200:
            print(f"⚠️  无法获取状态，跳过并发测试")
            return None

        status = status_resp.json()
        available = status.get('tabs_available', 0)

        if available < 2:
            print(f"⚠️  可用tabs不足（{available}），跳过并发测试")
            return None

        # 发送2个并发请求
        import concurrent.futures

        def send_request(n):
            payload = {"message": f"Concurrent test {n}"}
            try:
                resp = requests.post(
                    f"{LAZY_SERVER_URL}/chat",
                    json=payload,
                    timeout=60
                )
                return (n, resp.status_code, resp.json())
            except Exception as e:
                return (n, None, {"error": str(e)})

        print(f"发送2个并发请求...")
        start = time.time()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(send_request, i) for i in range(2)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        elapsed = time.time() - start

        success_count = sum(1 for _, status, _ in results if status == 200)

        print(f"✓ 并发测试完成")
        print(f"  - 耗时: {elapsed:.2f}秒")
        print(f"  - 成功: {success_count}/2")

        for n, status, data in sorted(results):
            if status == 200 and "content" in data:
                print(f"  - 请求{n}: ✓ {len(data['content'])} 字符")
            else:
                print(f"  - 请求{n}: ✗ {data.get('error', 'Unknown error')}")

        return success_count == 2

    except Exception as e:
        print(f"❌ 并发测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_lazy_config_integration():
    """测试Lazy Mode配置集成"""
    print("\n" + "=" * 60)
    print("测试: Lazy Mode配置集成")
    print("=" * 60)

    try:
        from config import ConfigManager

        cm = ConfigManager()
        config = cm.get_config()

        if not config.get('lazy_session'):
            print(f"ℹ️  Lazy Mode当前未启用（lazy_session: false）")
            print(f"   要测试lazy mode，需要设置 lazy_session: true")
            return None

        print(f"✓ Lazy Mode已在配置中启用")

        accounts = cm.get_accounts()
        active_accounts = [a for a in accounts if a.is_active and not a.depleted]

        print(f"  - 可用账户: {len(active_accounts)}")

        return True

    except Exception as e:
        print(f"❌ 配置集成测试失败: {e}")
        return False


if __name__ == "__main__":
    results = []

    results.append(("Lazy Server运行", test_lazy_server_running()))
    results.append(("Lazy聊天功能", test_lazy_chat()))
    results.append(("Lazy并发能力", test_lazy_concurrent()))
    results.append(("配置集成", test_lazy_config_integration()))

    print("\n" + "=" * 60)
    print("Lazy Mode测试结果")
    print("=" * 60)

    for name, result in results:
        if result is None:
            status = "⊘ SKIP"
        elif result:
            status = "✓ PASS"
        else:
            status = "✗ FAIL"
        print(f"{status}: {name}")

    total = len(results)
    passed = sum(1 for _, r in results if r is True)
    failed = sum(1 for _, r in results if r is False)
    skipped = sum(1 for _, r in results if r is None)

    print(f"\n总计: {passed} 通过, {failed} 失败, {skipped} 跳过")

    sys.exit(0 if failed == 0 else 1)
