"""
测试 API Endpoints (需要API服务运行)
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
import json


API_BASE_URL = "http://localhost:8000"


def test_api_server_running():
    """测试API服务是否运行"""
    print("=" * 60)
    print("测试: API Server运行状态")
    print("=" * 60)

    try:
        resp = requests.get(f"{API_BASE_URL}/", timeout=5)
        print(f"✓ API Server运行中 (状态码: {resp.status_code})")
        return True
    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到API Server ({API_BASE_URL})")
        print(f"   请先启动: python main.py")
        return None
    except Exception as e:
        print(f"❌ API Server检查失败: {e}")
        return False


def test_models_endpoint():
    """测试/v1/models端点"""
    print("\n" + "=" * 60)
    print("测试: /v1/models端点")
    print("=" * 60)

    try:
        resp = requests.get(f"{API_BASE_URL}/v1/models", timeout=10)

        if resp.status_code != 200:
            print(f"❌ Models端点返回错误: {resp.status_code}")
            print(f"   响应: {resp.text}")
            return False

        data = resp.json()

        if "data" not in data:
            print(f"❌ 响应格式错误: 缺少'data'字段")
            return False

        models = data["data"]
        print(f"✓ Models端点正常")
        print(f"  - 模型数量: {len(models)}")

        expected_models = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"]

        print(f"\n  可用模型:")
        for model in models:
            model_id = model.get("id", "")
            print(f"    • {model_id}")

            if model_id not in expected_models:
                print(f"      ⚠️  意外的模型: {model_id}")

        # 验证所有期望的模型都存在
        model_ids = [m.get("id") for m in models]
        missing = [m for m in expected_models if m not in model_ids]

        if missing:
            print(f"\n  ❌ 缺少模型: {missing}")
            return False

        print(f"\n✓ 所有期望的模型都存在")
        return True

    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到API")
        return None
    except Exception as e:
        print(f"❌ Models端点测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_chat_completions_no_auth():
    """测试无认证的聊天请求"""
    print("\n" + "=" * 60)
    print("测试: /v1/chat/completions (无认证)")
    print("=" * 60)

    try:
        payload = {
            "model": "MiniMax-M2.7",
            "messages": [
                {"role": "user", "content": "Say 'test successful' in English"}
            ]
        }

        print(f"发送聊天请求（无Authorization header）...")
        resp = requests.post(
            f"{API_BASE_URL}/v1/chat/completions",
            json=payload,
            timeout=60
        )

        if resp.status_code != 200:
            print(f"❌ 请求失败: {resp.status_code}")
            print(f"   响应: {resp.text[:200]}")
            return False

        data = resp.json()

        if "error" in data:
            print(f"❌ API返回错误: {data['error']}")
            return False

        if "choices" not in data:
            print(f"❌ 响应格式错误: 缺少'choices'字段")
            return False

        choices = data["choices"]
        if not choices:
            print(f"❌ choices为空")
            return False

        message = choices[0].get("message", {})
        content = message.get("content", "")

        print(f"✓ 聊天请求成功（无需认证）")
        print(f"  - 模型: {data.get('model')}")
        print(f"  - 响应长度: {len(content)} 字符")
        print(f"  - 响应: {content[:150]}...")

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
        print(f"❌ 无法连接到API")
        return None
    except Exception as e:
        print(f"❌ 聊天测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_chat_streaming():
    """测试流式响应"""
    print("\n" + "=" * 60)
    print("测试: /v1/chat/completions (流式)")
    print("=" * 60)

    try:
        payload = {
            "model": "MiniMax-M2.7",
            "messages": [
                {"role": "user", "content": "Count from 1 to 3"}
            ],
            "stream": True
        }

        print(f"发送流式请求...")
        resp = requests.post(
            f"{API_BASE_URL}/v1/chat/completions",
            json=payload,
            stream=True,
            timeout=60
        )

        if resp.status_code != 200:
            print(f"❌ 请求失败: {resp.status_code}")
            return False

        chunks = []
        content_parts = []

        for line in resp.iter_lines():
            if not line:
                continue

            line_str = line.decode('utf-8')

            if not line_str.startswith('data: '):
                continue

            data_str = line_str[6:].strip()

            if data_str == '[DONE]':
                break

            try:
                chunk = json.loads(data_str)
                chunks.append(chunk)

                # 提取content
                choices = chunk.get('choices', [])
                if choices:
                    delta = choices[0].get('delta', {})
                    content = delta.get('content', '')
                    if content:
                        content_parts.append(content)

            except json.JSONDecodeError:
                continue

        full_content = ''.join(content_parts)

        print(f"✓ 流式响应成功")
        print(f"  - 收到chunks: {len(chunks)}")
        print(f"  - 完整内容长度: {len(full_content)} 字符")
        print(f"  - 内容: {full_content[:150]}...")

        if not chunks:
            print(f"❌ 未收到任何chunk")
            return False

        return True

    except requests.exceptions.Timeout:
        print(f"❌ 请求超时")
        return False
    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到API")
        return None
    except Exception as e:
        print(f"❌ 流式测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_all_models():
    """测试所有配置的模型"""
    print("\n" + "=" * 60)
    print("测试: 所有模型响应")
    print("=" * 60)

    models = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"]

    results = {}

    for model in models:
        print(f"\n测试模型: {model}")

        try:
            payload = {
                "model": model,
                "messages": [
                    {"role": "user", "content": "Hi"}
                ]
            }

            resp = requests.post(
                f"{API_BASE_URL}/v1/chat/completions",
                json=payload,
                timeout=60
            )

            if resp.status_code == 200:
                data = resp.json()
                if "choices" in data and data["choices"]:
                    content = data["choices"][0].get("message", {}).get("content", "")
                    print(f"  ✓ {model}: {len(content)} 字符")
                    results[model] = True
                else:
                    print(f"  ✗ {model}: 响应格式错误")
                    results[model] = False
            else:
                print(f"  ✗ {model}: 状态码 {resp.status_code}")
                results[model] = False

        except Exception as e:
            print(f"  ✗ {model}: {str(e)[:50]}")
            results[model] = False

    success_count = sum(1 for v in results.values() if v)
    total = len(results)

    print(f"\n总结: {success_count}/{total} 模型测试通过")

    return success_count == total


if __name__ == "__main__":
    results = []

    results.append(("API Server运行", test_api_server_running()))
    results.append(("Models端点", test_models_endpoint()))
    results.append(("聊天无认证", test_chat_completions_no_auth()))
    results.append(("流式响应", test_chat_streaming()))
    results.append(("所有模型", test_all_models()))

    print("\n" + "=" * 60)
    print("API测试结果")
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
