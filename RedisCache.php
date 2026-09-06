<?php
namespace Pusher\Cache;
use Pusher\KV;
/**
 * Redis 缓存操作类
 */
class RedisCache extends KV {

    /**
     * 配置属性
     * @var mixed
     */
    private $config = array();
    
    /**
     * redis服务器连接对象
     * @var object
     */
    private $redis;
    
    /**
     * redis短连接
     * @param array $config Redis服务器配置信息数组
     * @return mixed
     * @throws \Exception
     */
    public function __construct($config = array('driver' => 'Redis', 'nodes' => array(), 'scheme' => 'tcp', 'host' => '127.0.0.1', 'port' => 6379, 'timeout'=> 5.0)) {
        // 默认驱动为Redis
        if(!isset($config['driver'])) {
            $config['driver'] = 'Redis';
        }
        // 默认集群节点
        if(!isset($config['nodes'])) {
            $config['nodes'] = array();
        }
        // 默认协议
        if(!isset($config['scheme'])) {
            $config['scheme'] = 'tcp';
        }
        // 默认单机地址
        if(!isset($config['host'])) {
            $config['host'] = '127.0.0.1';
        }
        // 默认单机地址端口
        if(!isset($config['port'])) {
            $config['port'] = 6379;
        }
        // 默认超时时间
        if(!isset($config['timeout'])) {
            $config['timeout'] = 5.0;
        }
        // 默认缓存时间
        if(!isset($config['seconds'])) {
            $config['seconds'] = 0;
        }else{
            $config['seconds'] = (int) $config['seconds'];
        }
        // 优先使用C扩展的Redis客户端
        if($config['driver'] == 'Redis' && class_exists('Redis')) {
            $config['driver'] = 'Redis';
        }else{
            $config['driver'] = 'Predis';
        }
        if($config['driver'] == 'Redis') {
            // 判断是否为扩展集群连接
            if(isset($config['nodes']) && !empty($config['nodes'])) {
                $cluster = array_merge($config['nodes'], $config['timeout'], $config['timeout']);
                $this->redis = new RedisCluster(null, $cluster);
            }else{
                $this->redis = new \Redis();
            }
            try{
                $this->redis->connect($config['host'], $config['port'], $config['timeout']);
                if(isset($config['password']) && !empty($config['password'])) {
                    if(!$this->redis->auth($config['password'])) {
                        throw new \Exception('redis password error');
                    }
                }else if(isset($config['parameters']['password']) && !empty($config['parameters']['password'])){
                    if(!$this->redis->auth($config['password'])) {
                        throw new \Exception('redis password error');
                    }
                }
            }catch(Exception $e) {
                throw new \Exception($e->getMessage(), $e->getCode());
            }
        }else{
            // 判断是否为Predis集群连接
            if(isset($config['nodes']) && !empty($config['nodes'])) {
                $config['cluster'] = 'redis';
                $cluster = $config['nodes'];
                $this->redis = new \Predis\Client($cluster, $config);
            }else{
                $this->redis = new \Predis\Client($config);
            }
        }
        $this->config = $config;
    }

    /**
     * 获取当前实例配置
     * @return array $config
     */
    public function getConfig() {
        return $this->config;
    }

    /**
     * 获取$key的文件路径
     * @param string $key 键KEY
     * @return string 文件路径
     */
    public function _path($key) {
        // 如果是Predis，可以自动识别prefix，无需手动处理
        if(isset($this->config['prefix']) && $this->config["driver"] != "Predis") {
            $key = $this->config['prefix'].$key;
        }
        if(isset($this->config['suffix'])) {
            $key = $key.$this->config['suffix'];
        }
        return $key;
    }

    /**
     * 获取$key是否存在,存在返回true,不存在返回false
     * @param string $key 键KEY
     * @return boolean 键KEY存在状态
     */
    public function exists($key) {
        $key = $this->_path($key);
        $flag = $this->redis->exists($key);
        return $flag ? true : false;
    }
     
    /**
     * 获取$key的值,如果$key不存在则返回null
     * @param string $key 键KEY
     * @return string 返回值 
     */
    public function get($key) {
        $key = $this->_path($key);
        return $this->redis->get($key);
    }
    
    /**
     * 设置$key的值,设置成功返回true,失败返回false
     * @param string $key 键KEY
     * @param string $val 键KEY的值
     * @param string $expireTTL 键过期时间
     * @return boolean 设置状态
     */
    public function set($key, $val, $expireTTL = 0) {
        $key = $this->_path($key);
        if($expireTTL > 0) {
            return $this->redis->setex($key, $expireTTL, $val);
        }else{
            return $this->redis->set($key, $val);
        }
    }
    
    /**
     * 设置$key的值,如果该$key不存在则设置为$val,否则返回false
     * @param string $key 键KEY
     * @param string $val 键KEY的值
     * @param string $expireTTL 键过期时间
     * @return boolean 设置状态
     */
    public function setnx($key, $val, $expireTTL = 0) {
        $key = $this->_path($key);
        if($expireTTL > 0) {
            $flag = $this->redis->setnx($key, $val);
            if($flag) {
                return $this->redis->expire($key, $expireTTL);
            }
        }else{
            return $this->redis->setnx($key, $val);
        }
    }
    
    /**
     * 增加$key的值,返回增加后的值,如果$key不存在则尝试创建之为默认值0然后增加返回
     * @param string $key 键KEY
     * @param int $default 增加大小
     * @param string $expireTTL 键过期时间
     * @return int 增加后的值
     */
    public function incr($key, $default = 1, $expireTTL = 0) {
        $key = $this->_path($key);
        if($this->config['driver'] === 'Predis') {
            if($expireTTL > 0) {
                $flag = $this->redis->incrby($key, $default);
                if($flag) {
                    return $this->redis->expire($key, $expireTTL);
                }
            }else{
                return $this->redis->incrby($key, $default);
            }
        }else{
            if($expireTTL > 0) {
                $flag = $this->redis->incr($key, $default);
                if($flag) {
                    return $this->redis->incr($key, $expireTTL);
                }
            }else{
                return $this->redis->incr($key, $default);
            }
        }
    }
    
    /**
     * 减小$key的值,返回减小后的值,如果$key不存在则尝试创建之为默认值0然后减小返回
     * @param string $key 键KEY
     * @param int $default 减小大小
     * @param string $expireTTL 键过期时间
     * @return int 减小后的值
     */
    public function decr($key, $default = 1, $expireTTL = 0) {
        $key = $this->_path($key);
        if($this->config['driver'] === 'Predis') {
            if($expireTTL > 0) {
                $flag = $this->redis->decrby($key, $default);
                if($flag) {
                    return $this->redis->decrby($key, $expireTTL);
                }
            }else{
                return $this->redis->decrby($key, $default);
            }
        }else{
            if($expireTTL > 0) {
                $flag = $this->redis->decr($key, $default);
                if($flag) {
                    return $this->redis->decr($key, $expireTTL);
                }
            }else{
                return $this->redis->decr($key, $default);
            }
        }
    }
    
    /**
     * 删除$key,删除成功返回true,如果$key不存在则返回false
     * @param string $key 键KEY
     * @return boolean 删除状态
     */
    public function del($key) {
        return $this->delete($key);
    }
    
    /**
     * 删除$key,删除成功返回true,如果$key不存在则返回false
     * @param string $key 键KEY
     * @return boolean 删除状态
     */
    public function delete($key) {
        $key = $this->_path($key);
        if($this->config['driver'] === 'Predis') {
            return $this->redis->del($key);
        }else{
            return $this->redis->delete($key);
        }
    }
    
    /**
     * 获取$key列表的长度,$key不存在返回0
     * @param string $key 键KEY
     * @return int 列表的长度
     */
    public function llen($key) {
        $key = $this->_path($key);
        return $this->redis->llen($key);
    }
    
    /**
     * 由列表头部添加字符串值,成功返回数组长度,如果不存在则尝试创建之并添加,不是一个列表，返回FALSE
     * @param string $key 键KEY
     * @param string $string 添加的元素的内容
     * @return mixed 长度或添加状态
     */
    public function lpush($key, $string) {
        $key = $this->_path($key);
        return $this->redis->lpush($key, $string);
    }
    
    /**
     * 在key对应list的尾部添加字符串元素,成功返回数组长度,如果不存在则尝试创建之并添加,不是一个列表，返回FALSE
     * @param string $key 键KEY
     * @param string $string 添加的元素的内容
     * @return mixed 返回数组长度, 失败返回FALSE
     */
    public function rpush($key, $string) {
        $key = $this->_path($key);
        return $this->redis->rpush($key, $string);
    }
 
    /**
     * 移除列表的第一个元素,成功返回第一个元素的值,失败返回false
     * @param string $key 键KEY
     * @return mixed 移除元素的值, 失败返回FALSE
     */
    public function lpop($key) {
        $key = $this->_path($key);
        return $this->redis->lpop($key);
    }
    
    /**
     * 移除列表的最后一个元素,成功返回最后一个元素的值,失败返回false
     * @param string $key 键KEY
     * @return mixed 移除的元素值
     */
    public function rpop($key) {
        $key = $this->_path($key);
        return $this->redis->rpop($key);
    }
    
    /**
     * 获取列表中指定的元素。 0第一个元素，1第二个… -1最后一个元素，-2的倒数第二…错误的索引或键不指向列表则返回FALSE
     * @param string $key 键KEY
     * @param string $index 索引
     * @return mixed 指定元素值,不存在返回FALSE
     */
    public function lget($key, $index = 0) {
        $key = $this->_path($key);
        if($this->config['driver'] === 'Predis') {
            return $this->redis->lindex($key, $index);
        }else{
            return $this->redis->lget($key, $index);
        }
    }

    /**
     * 设置列表中指定索引的元素值为$val。 0第一个元素，1第二个… -1最后一个元素
     * @param string $key 键KEY
     * @param string $index 索引
     * @param string $val 值
     * @return mixed 指定元素值,不存在返回FALSE
     */
    public function lset($key, $index, $val) {
        $key = $this->_path($key);
        return $this->redis->lset($key, $index, $val);
    }

    /**
     * 获取key的过期剩余秒数(当 key 不存在时，返回 -2 。当 key 存在但没有设置剩余生存时间时，返回 -1)
     * @param string $key 键KEY
     * @return int 离过期剩余秒数
     */
    public function ttl($key) {
        $key = $this->_path($key);
        if($this->config['driver'] === 'Predis') {
            if(!$this->redis->exists($key)){
                return -2;
            }
            return $this->redis->ttl($key);
        }else{
            return $this->redis->ttl($key);
        }
    }
    
    /**
     * 设置key的过期时间
     * @param string $key 键KEY
     * @param string $seconds 过期秒数
     * @return boolean 设置状态
     */
    public function expire($key, $seconds) {
        $key = $this->_path($key);
        return $this->redis->expire($key, $seconds);
    }

    /**
     * 仅替换一次
     * @param string $needle 要查找的字符串
     * @param string $replace 替换后的字符串
     * @param string $haystack 需要处理的字符串
     * @return string 处理后的字符串
     */
    function str_replace_once($needle, $replace, $haystack) {
        if(empty($needle)) {
            return $haystack;
        }
        $pos = strpos($haystack, $needle);
        if ($pos === false) {
            return $haystack;
        }
        return substr_replace($haystack, $replace, $pos, strlen($needle));
    }

    /**
     * 获取前缀为$prefix的所有元素
     * @param string $prefix key前缀
     * @return array 所有key组成的数组
     */
    public function keys($prefix = "") {
        if(empty($prefix)) {
            $prefix = $this->config['prefix'];
        }
        $result = array();
        $keys = $this->redis->keys($prefix."*");
        if(!empty($keys)) {
            foreach($keys as $key) {
                $result[] = $this->str_replace_once($prefix, "", $key);
            }
        }
        return $result;
    }

}

