;(async () => {
  const panelName = 'Switch Policy Panel'
  class logger {
    static consoleRaw = console
    static log(message) {
      message = `[ LOG ] ${message}`
      this.consoleRaw.log(message)
    }

    static error(message) {
      message = `[ ERROR ] ${message}`
      this.consoleRaw.log(message)
    }
  }
  const scriptVersion = '1.0'
  const scriptUpdateTime = '2022-10-14 10:43:33'
  logger.log(
    `##### Switch policy Panel:\n@script version: v${scriptVersion}\n@script update: ${scriptUpdateTime}`
  )

  const arguments = getParams($argument)
  // 指定显示状态的 Policy Group
  const settedPolicyGroupName = arguments.policyName
  // 所有 代理服务器/策略组内容
  const allPolicyGroup = await httpAPI('/v1/policy_groups')
  const settedPolicyGroupInfo = await currentGroupSelected(settedPolicyGroupName)
  if (!settedPolicyGroupInfo.policy) {
    $done({
      title: settedPolicyGroupName,
      content: `Monitoring strategy group【${settedPolicyGroupName}】It does not exist，Please modify the parameters in the module. policyName Value，And restart Surge`,
      icon: arguments.icon,
      'icon-color': arguments.color,
    })
  }
  const policyName = settedPolicyGroupInfo.policy

  // 当前策略组的所有子选项信息
  const policyGroupChildren = allPolicyGroup[settedPolicyGroupName]
  const policyNameArray = policyGroupChildren.map(item => item.name)

  // 当前策略组选中的子选项索引
  let currentPolicyChildrenIndex = policyNameArray.findIndex(item => item === policyName)

  if ($trigger == 'button') {
    currentPolicyChildrenIndex += 1
    if (currentPolicyChildrenIndex > policyGroupChildren.length - 1) {
      currentPolicyChildrenIndex = 0
    }
    $surge.setSelectGroupPolicy(settedPolicyGroupName, policyNameArray[currentPolicyChildrenIndex])
  }

  let currentPolicyChildrenName = policyNameArray[currentPolicyChildrenIndex]
  let secondName
  let rootName = currentPolicyChildrenName
  const allPolicyGroupKey = Object.keys(allPolicyGroup)
  if (allPolicyGroupKey.includes(rootName) == true) {
    secondName = await currentGroupSelected(rootName).policy
    currentPolicyChildrenName = 'Current strategy：' + currentPolicyChildrenName + '\n'
  }

  while (allPolicyGroupKey.includes(rootName) == true) {
    const target = await currentGroupSelected(rootName)
    rootName = target.policy
  }

  if (policyGroupChildren[currentPolicyChildrenIndex].isGroup == true && secondName != rootName) {
    currentPolicyChildrenName = currentPolicyChildrenName + 'The final node：' + rootName
  }
  $notification.post(panelName, settedPolicyGroupName, currentPolicyChildrenName)
  $done({
    title: settedPolicyGroupName,
    content: currentPolicyChildrenName,
    icon: arguments.icon,
    'icon-color': arguments.color,
  })
})()

function httpAPI(path = '', method = 'GET', body = null) {
  return new Promise(resolve => {
    $httpAPI(method, path, body, result => {
      resolve(result)
    })
  })
}

function getParams(param) {
  return Object.fromEntries(
    $argument
      .split('&')
      .map(item => item.split('='))
      .map(([k, v]) => [k, decodeURIComponent(v)])
  )
}

/**
 * @desc 查找指定 Proxy Group 当前选中子选项信息
 * @param {String} groupName
 * @return {Object} groupInfo
 */
async function currentGroupSelected(groupName) {
  const response = await httpAPI(
    '/v1/policy_groups/select?group_name=' + encodeURIComponent(groupName) + ''
  )
  return response
}
