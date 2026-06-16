"""
测试配置管理
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from pathlib import Path
from config import ConfigManager, Account


def test_config_load():
    """测试配置加载"""
    print("=" * 60)
    print("测试: 配置加载")
    print("=" * 60)

    config_file = Path(__file__).parent.parent / "config.json"
    if not config_file.exists():
        print("❌ config.json 不存在")
        return False

    try:
        cm = ConfigManager(str(config_file))
        config = cm.get_config()

        print(f"✓ 配置加载成功")
        print(f"  - Default Model: {config['default_model']}")
        print(f"  - Available Models: {len(config['available_models'])}")
        print(f"  - Accounts: {len(config['accounts'])}")
        print(f"  - Lazy Session: {config['lazy_session']}")
        print(f"  - Proxy API Keys: {len(config['proxy_api_keys'])}")

        # 验证模型列表
        expected_models = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"]
        if config['available_models'] != expected_models:
            print(f"❌ 模型列表不匹配")
            print(f"   期望: {expected_models}")
            print(f"   实际: {config['available_models']}")
            return False

        print(f"✓ 模型列表正确")

        # 验证无认证模式
        if config['proxy_api_keys']:
            print(f"⚠️  警告: proxy_api_keys 不为空，认证已启用")
        else:
            print(f"✓ 无认证模式（proxy_api_keys为空）")

        return True

    except Exception as e:
        print(f"❌ 配置加载失败: {e}")
        return False


def test_account_management():
    """测试账户管理"""
    print("\n" + "=" * 60)
    print("测试: 账户管理")
    print("=" * 60)

    try:
        cm = ConfigManager()
        accounts = cm.get_accounts()

        if not accounts:
            print("❌ 没有账户")
            return False

        print(f"✓ 找到 {len(accounts)} 个账户")

        for i, acc in enumerate(accounts, 1):
            print(f"\n账户 {i}:")
            print(f"  - Name: {acc.name}")
            print(f"  - Email: {acc.email}")
            print(f"  - Active: {acc.is_active}")
            print(f"  - Depleted: {acc.depleted}")
            print(f"  - Temporarily No Credits: {acc.temporarily_no_credits}")
            print(f"  - Auth Mode: {acc.auth_mode}")

            # 验证必需字段
            if not acc.email or not acc.password:
                print(f"  ❌ 缺少email或password")
                return False

            if acc.auth_mode != "web":
                print(f"  ⚠️  警告: auth_mode不是'web': {acc.auth_mode}")

        print(f"\n✓ 所有账户验证通过")
        return True

    except Exception as e:
        print(f"❌ 账户管理测试失败: {e}")
        return False


def test_account_update():
    """测试账户更新（24h cooldown）"""
    print("\n" + "=" * 60)
    print("测试: 账户更新机制")
    print("=" * 60)

    try:
        cm = ConfigManager()
        accounts = cm.get_accounts()

        if not accounts:
            print("❌ 没有账户可测试")
            return False

        test_acc = accounts[0]
        original_state = test_acc.temporarily_no_credits

        # 模拟临时耗尽
        import time
        test_acc.temporarily_no_credits = True
        test_acc.credits_check_after = time.time() + (24 * 60 * 60)

        cm.update_account(test_acc)
        print(f"✓ 设置账户 {test_acc.email} 为临时耗尽状态")

        # 重新加载验证
        cm_reload = ConfigManager()
        accounts_reload = cm_reload.get_accounts()
        test_acc_reload = next((a for a in accounts_reload if a.email == test_acc.email), None)

        if not test_acc_reload:
            print(f"❌ 无法重新加载账户")
            return False

        if test_acc_reload.temporarily_no_credits:
            print(f"✓ 临时耗尽状态已持久化")
        else:
            print(f"❌ 临时耗尽状态未持久化")
            return False

        # 恢复原状态
        test_acc_reload.temporarily_no_credits = original_state
        test_acc_reload.credits_check_after = 0
        cm_reload.update_account(test_acc_reload)
        print(f"✓ 恢复账户原状态")

        return True

    except Exception as e:
        print(f"❌ 账户更新测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    results = []

    results.append(("配置加载", test_config_load()))
    results.append(("账户管理", test_account_management()))
    results.append(("账户更新", test_account_update()))

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)

    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")

    total = len(results)
    passed = sum(1 for _, r in results if r)

    print(f"\n总计: {passed}/{total} 通过")

    sys.exit(0 if passed == total else 1)
